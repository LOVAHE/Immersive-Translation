import { extractPdf } from '../pdf/extract.js';
import { getSettings } from '../core/settings.js';
import { ocrImageBlob } from '../ocr/tesseract.js';

const api = (globalThis.browser ?? globalThis.chrome);
const qs = new URLSearchParams(location.search);
const src = qs.get('src');

(async function main() {
  if (!src) { document.body.textContent = 'Missing ?src='; return; }
  const s = await getSettings();
  const ab = await fetch(src, { credentials: 'include' }).then(r => r.arrayBuffer());
  const doc = await extractPdf({ arrayBuffer: ab, dpi: 180 });

  const container = document.getElementById('c');

  for (const p of doc.pages) {
    const pageHost = document.createElement('div');
    pageHost.className = 'page';
    pageHost.style.width = p.width + 'px';
    pageHost.style.height = p.height + 'px';

    const img = document.createElement('img');
    img.src = URL.createObjectURL(p.blob);
    img.style.display = 'block';
    img.style.width = '100%';
    pageHost.appendChild(img);

    const layer = document.createElement('div');
    layer.className = 'layer';
    layer.style.width = p.width + 'px';
    layer.style.height = p.height + 'px';
    pageHost.appendChild(layer);
    container.appendChild(pageHost);

    if (p.mode === 'text') {
      const items = groupLines(p.items);
      const SEP = '\n\u2063\u2063\u2063\n';
      const payload = items.map(it => it.text).join(SEP);
      const resp = await api.runtime.sendMessage({ action: 'translateText', text: payload, targetLang: s.targetLang });
      if (!resp?.ok) continue;
      const parts = (resp.result?.translated || '').split(SEP);
      items.forEach((it, i) => addBlock(layer, it.bbox, it.text, parts[i] || ''));
    } else {
      let words = [];
      try {
        if (s.ocrEnabled && s.ocrEngine === 'tesseract') {
          const langs = (s.ocrLangs || 'eng').split(',').map(x => x.trim()).filter(Boolean);
          const out = await ocrImageBlob(p.blob, langs);
          words = out.words || [];
        }
      } catch (e) { /* ignore */ }
      if (words.length) {
        const lines = clusterLines(words);
        const SEP = '\n\u2063\u2063\u2063\n';
        const payload = lines.map(l => l.text).join(SEP);
        const resp2 = await api.runtime.sendMessage({ action: 'translateText', text: payload, targetLang: s.targetLang });
        if (resp2?.ok) {
          const parts = (resp2.result?.translated || '').split(SEP);
          lines.forEach((l, i) => addBlock(layer, scaleRenderedBbox(l.bbox, p), l.text, parts[i] || ''));
        }
      } else if (s.visionFallback) {
        const dataUrl = await blobToDataURL(p.blob);
        const response = await api.runtime.sendMessage({
          action: 'visionTranslate',
          details: { imageDataUrl: dataUrl, targetLang: s.targetLang }
        });
        if (response?.ok) {
          const { translated } = response.result;
          addCentered(layer, translated);
        }
      }
    }
  }
})();

function scaleRenderedBbox(bbox, page) {
  const sx = page.width / (page.renderWidth || page.width);
  const sy = page.height / (page.renderHeight || page.height);
  const [x1, y1, x2, y2] = bbox;
  return [x1 * sx, y1 * sy, x2 * sx, y2 * sy];
}

function addBlock(layer, bbox, src, tgt) {
  const [x1, y1, x2, y2] = bbox;
  const el = document.createElement('div');
  el.className = 'block';
  Object.assign(el.style, {
    left: x1 + 'px',
    top: y1 + 'px',
    minWidth: (x2 - x1) + 'px',
    maxWidth: Math.max(300, (x2 - x1) * 1.2) + 'px'
  });

  el.innerHTML = `<div class="tl-bubble">${escapeHTML(tgt)}</div>`;
  layer.appendChild(el);
}
function addCentered(layer, text) {
  const el = document.createElement('div');
  el.className = 'block';
  el.style.left = '50%'; el.style.top = '50%';
  el.style.transform = 'translate(-50%,-50%)';
  el.style.background = 'rgba(0,0,0,.6)';
  el.style.fontSize = '16px';
  el.innerHTML = `<span class="row tl">${escapeHTML(text)}</span>`;
  layer.appendChild(el);
}
function groupLines(items) {
  const sorted = [...items].sort((a, b) => (a.bbox[1] - b.bbox[1]) || (a.bbox[0] - b.bbox[0]));
  const rows = []; const yTol = 4;
  for (const it of sorted) {
    const y = (it.bbox[1] + it.bbox[3]) / 2;
    let row = rows.find(r => Math.abs(r.y - y) < yTol);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push(it);
  }
  return rows.map(r => {
    const text = r.items.map(i => i.text).join(' ');
    const xs = r.items.flatMap(i => [i.bbox[0], i.bbox[2]]);
    const ys = r.items.flatMap(i => [i.bbox[1], i.bbox[3]]);
    return { text, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
}
function clusterLines(words) {
  const sorted = [...words].sort((a, b) => (a.bbox[1] - b.bbox[1]) || (a.bbox[0] - b.bbox[0]));
  const rows = []; const yTol = 10;
  for (const w of sorted) {
    const y = (w.bbox[1] + w.bbox[3]) / 2;
    let row = rows.find(r => Math.abs(r.y - y) < yTol);
    if (!row) { row = { y, words: [] }; rows.push(row); }
    row.words.push(w);
  }
  return rows.map(r => {
    const xs = r.words.flatMap(w => [w.bbox[0], w.bbox[2]]);
    const ys = r.words.flatMap(w => [w.bbox[1], w.bbox[3]]);
    return { text: r.words.map(w => w.text).join(' '), bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
}
function escapeHTML(s = '') { return String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }
function blobToDataURL(b) { return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }
