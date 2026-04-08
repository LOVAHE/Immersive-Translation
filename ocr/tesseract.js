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
    const api = globalThis.chrome ?? globalThis.browser;
    const Tesseract = await loadFromCdn();
    const worker = await Tesseract.createWorker({
      workerPath: api.runtime.getURL('vendor/worker.min.js'),
      corePath: api.runtime.getURL('vendor/tesseract-core.wasm.js'),
      logger: ()=>{}
    });
    await worker.load();
    return worker;
  })();
  return workerPromise;
}

async function loadFromCdn() {
  const api = globalThis.chrome ?? globalThis.browser;
  const url = api.runtime.getURL('vendor/tesseract.min.js');
  const mod = await import(/* @vite-ignore */ url);
  return mod.default || mod;
}
