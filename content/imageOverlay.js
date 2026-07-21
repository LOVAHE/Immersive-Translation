import { getSettings } from '../core/settings.js';
import { createBatchPayload, splitBatchTranslation } from '../core/batchTranslation.js';
import { ocrImageBlob } from '../ocr/tesseract.js';

const api = globalThis.browser ?? globalThis.chrome;
const overlayByImage = new WeakMap();

export async function translateImageFromUrl(imgUrl) {
  const s = await getSettings();
  if (!s.ocrEnabled && !s.visionFallback) throw new Error('OCR disabled');
  const resp = await fetch(imgUrl, { credentials:'include' });
  if (!resp.ok) throw new Error(`Image fetch failed: ${resp.status}`);
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
    const payload = createBatchPayload(lines.map(l => l.text));
    const resp2 = await api.runtime.sendMessage({ action:'translateText', text: payload, targetLang: s.targetLang });
    if (!resp2?.ok) throw new Error(resp2?.error || 'translate failed');
    const batch = splitBatchTranslation(resp2.result?.translated || '', lines.length);
    if (!batch.matched) {
      console.warn('[IT] Image translation count mismatch', {
        expected: batch.expectedCount,
        actual: batch.actualCount
      });
    }
    resultItems = lines.map((l, i) => ({ bbox: l.bbox, src: l.text, tgt: batch.items[i] }));
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

export function getOverlayBoxPercentages(bbox, naturalWidth, naturalHeight) {
  const [x1, y1, x2, y2] = bbox;
  if (!(x2 > x1 && y2 > y1 && naturalWidth > 0 && naturalHeight > 0)) return null;
  return {
    left: x1 / naturalWidth * 100,
    top: y1 / naturalHeight * 100,
    width: (x2 - x1) / naturalWidth * 100,
    height: (y2 - y1) / naturalHeight * 100
  };
}

export function mountOverlayOnImage(imgUrl, items) {
  const img = [...document.images].find(i => i.currentSrc === imgUrl || i.src === imgUrl);
  if (!img) return;

  overlayByImage.get(img)?.dispose();

  const host = document.createElement('div');
  host.dataset.itImageOverlay = 'true';
  host.style.cssText = 'position:absolute;pointer-events:none;z-index:2147483647;contain:layout style;';
  document.body.appendChild(host);

  let resizeObserver = null;
  let removalObserver = null;
  const record = { host, dispose: null };
  let updatePosition;
  const dispose = () => {
    resizeObserver?.disconnect();
    removalObserver?.disconnect();
    window.removeEventListener('resize', updatePosition);
    window.removeEventListener('scroll', updatePosition, true);
    host.remove();
    if (overlayByImage.get(img) === record) overlayByImage.delete(img);
  };
  record.dispose = dispose;
  overlayByImage.set(img, record);

  updatePosition = () => {
    if (!img.isConnected) {
      dispose();
      return;
    }
    const rect = img.getBoundingClientRect();
    Object.assign(host.style, {
      left: `${rect.left + window.scrollX}px`,
      top: `${rect.top + window.scrollY}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
  };

  const closeLabel = api.i18n?.getMessage?.('closeImageTranslation') || 'Close image translation';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = '×';
  closeButton.title = closeLabel;
  closeButton.setAttribute('aria-label', closeLabel);
  closeButton.style.cssText = 'position:absolute;right:6px;top:6px;width:28px;height:28px;border:1px solid rgba(255,255,255,.7);border-radius:999px;background:rgba(15,23,42,.88);color:#fff;font:700 20px/24px system-ui;cursor:pointer;pointer-events:auto;z-index:2;box-shadow:0 2px 8px rgba(0,0,0,.35);';
  closeButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    dispose();
  });
  host.appendChild(closeButton);

  const naturalWidth = img.naturalWidth || img.getBoundingClientRect().width;
  const naturalHeight = img.naturalHeight || img.getBoundingClientRect().height;
  items.forEach(it => {
    const box = document.createElement('div');
    const geometry = getOverlayBoxPercentages(it.bbox, naturalWidth, naturalHeight);
    if (geometry) {
      Object.assign(box.style, {
        position:'absolute', left: `${geometry.left}%`, top: `${geometry.top}%`,
        width: `${geometry.width}%`, minHeight: `${geometry.height}%`,
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
    box.innerHTML = `${it.src ? `<div>${escapeHtml(it.src)}</div>` : ''}<div style="color:#b7e3ff">${escapeHtml(it.tgt)}</div>`;
    host.appendChild(box);
  });

  updatePosition();
  window.addEventListener('resize', updatePosition);
  window.addEventListener('scroll', updatePosition, true);
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(updatePosition);
    resizeObserver.observe(img);
  }
  if (typeof MutationObserver === 'function') {
    removalObserver = new MutationObserver(() => {
      if (!img.isConnected) dispose();
    });
    removalObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  return dispose;
}
function escapeHtml(s=''){return String(s).replace(/[&<>]/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));}
