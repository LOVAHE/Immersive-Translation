let pdfjsLib = null;

export async function extractPdf({ arrayBuffer, dpi = 180 }) {
  if (!pdfjsLib) pdfjsLib = await loadPdfJs();
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const renderScale = (dpi / 72);
    const renderViewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = renderViewport.width | 0;
    canvas.height = renderViewport.height | 0;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.90));

    const text = await page.getTextContent().catch(() => null);
    if (text?.items?.length) {
      const items = text.items.map(it => ({
        text: it.str,
        bbox: rectFromTransform(it.transform, it.width, it.height, viewport.height),
        page: i
      }));
      pages.push({ page: i, mode: 'text', items, blob, width: viewport.width, height: viewport.height });
    } else {
      pages.push({ page: i, mode: 'image', blob, width: viewport.width, height: viewport.height });
    }
  }
  return { numPages: doc.numPages, pages };
}

function rectFromTransform(tr, w, h, pageHeight) {
  const x = tr[4], y = tr[5];
  return [x, pageHeight - y - h, x + w, pageHeight - y];
}

async function loadPdfJs() {
  const api = globalThis.chrome ?? globalThis.browser;
  const workerUrl = api.runtime.getURL('vendor/pdf.worker.min.mjs');
  const mainUrl = api.runtime.getURL('vendor/pdf.min.mjs');
  const mod = await import(/* @vite-ignore */ mainUrl);
  mod.GlobalWorkerOptions.workerSrc = workerUrl;
  return mod;
}
