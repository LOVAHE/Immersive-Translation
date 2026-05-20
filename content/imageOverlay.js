import { getSettings } from '../core/settings.js';
import { ocrImageBlob } from '../ocr/tesseract.js';

const api = globalThis.browser ?? globalThis.chrome;

export async function translateImageFromUrl(imgUrl) {
  const s = await getSettings();
  if (!s.ocrEnabled && !s.visionFallback) throw new Error('OCR disabled');
  const resp = await fetch(imgUrl, { credentials:'include' });
  const blob = await resp.blob();

  let words = [];
  try {
    if (s.ocrEnabled && s.ocrEngine === 'tesseract') {
      const langs = (s.ocrLangs || 'eng').split(',').map(x=>x.trim()).filter(Boolean);
      const out = await ocrImageBlob(blob, langs);
      words = out.words || [];
    } else {
      words = []; // vision fallback only
    }
  } catch (e) {
    if (!(s.visionFallback)) throw e;
  }

  let resultItems = [];
  if (words.length) {
    const lines = clusterLines(words);
    const SEP = '\n\u2063\u2063\u2063\n';
    const payload = lines.map(l => l.text).join(SEP);
    const resp2 = await api.runtime.sendMessage({ action:'translateText', text: payload, targetLang: s.targetLang });
    if (!resp2?.ok) throw new Error(resp2?.error || 'translate failed');
    const translatedParts = (resp2.result?.translated || '').split(SEP);
    resultItems = lines.map((l, i) => ({ bbox: l.bbox, src: l.text, tgt: translatedParts[i] || '' }));
  } else if (s.visionFallback) {
    const reader = new FileReader();
    const dataUrl = await new Promise(r => { reader.onload = () => r(reader.result); reader.readAsDataURL(blob); });
    const response = await api.runtime.sendMessage({
      action: 'visionTranslate',
      details: { imageDataUrl: dataUrl, targetLang: s.targetLang }
    });
    if (!response?.ok) throw new Error(response?.error || 'Vision translate failed');
    const { translated } = response.result;
    resultItems = [{ bbox: [0,0,0,0], src: '', tgt: translated }];
  }

  mountOverlayOnImage(imgUrl, resultItems);
}

function clusterLines(words) {
  const sorted = [...words].sort((a,b)=> (a.bbox[1]-b.bbox[1]) || (a.bbox[0]-b.bbox[0]));
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
    return { text: r.words.map(w=>w.text).join(' '), bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });
}

function mountOverlayOnImage(imgUrl, items) {
  const img = [...document.images].find(i => i.src === imgUrl);
  if (!img) return;
  const rect = img.getBoundingClientRect();
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:${rect.left + window.scrollX}px;top:${rect.top + window.scrollY}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;z-index:2147483647;`;
  document.body.appendChild(host);
  items.forEach(it => {
    const box = document.createElement('div');
    let [x1,y1,x2,y2] = it.bbox;
    const sx = rect.width / img.naturalWidth;
    const sy = rect.height / img.naturalHeight;
    if (x2 > x1 && y2 > y1) {
      Object.assign(box.style, {
        position:'absolute', left: (x1*sx)+'px', top: (y1*sy)+'px', width: ((x2-x1)*sx)+'px',
        background:'rgba(0,0,0,.35)', color:'#fff', padding:'2px 4px', borderRadius:'4px',
        font:'14px/1.25 system-ui', textShadow:'0 1px 2px rgba(0,0,0,.5)'
      });
    } else {
      Object.assign(box.style, {
        position:'absolute', left:'50%', top:'50%', transform:'translate(-50%,-50%)',
        background:'rgba(0,0,0,.55)', color:'#b7e3ff', padding:'6px 10px', borderRadius:'6px',
        font:'16px/1.25 system-ui', textShadow:'0 1px 2px rgba(0,0,0,.5)'
      });
    }
    box.innerHTML = `${it.src ? `<div>${escape(it.src)}</div>` : ''}<div style="color:#b7e3ff">${escape(it.tgt)}</div>`;
    host.appendChild(box);
  });
}
function escape(s=''){return String(s).replace(/[&<>]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));}
