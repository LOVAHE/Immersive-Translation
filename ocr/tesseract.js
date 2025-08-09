let workerPromise = null;
let loadedLang = '';

export async function ocrImageBlob(blob, langs = ['eng']) {
  const worker = await getWorker();
  const langStr = langs.join('+');
  if (langStr !== loadedLang) {
    await worker.loadLanguage(langStr);
    await worker.initialize(langStr);
    loadedLang = langStr;
  }
  const { data } = await worker.recognize(blob, {});
  return {
    text: data.text,
    words: (data.words || []).map(w => ({ text: w.text, bbox: [w.bbox.x0, w.bbox.y0, w.bbox.x1, w.bbox.y1] }))
  };
}

async function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const Tesseract = await loadFromCdn();
    const worker = await Tesseract.createWorker({ logger: ()=>{} });
    await worker.load();
    return worker;
  })();
  return workerPromise;
}

async function loadFromCdn() {
  const url = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
  const mod = await import(/* @vite-ignore */ url);
  return mod;
}
