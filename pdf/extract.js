let pdfjsLib = null;

export async function extractPdf({ arrayBuffer, dpi = 180 }) {
  if (!pdfjsLib) pdfjsLib = await loadPdfJs();
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];
  for (let i=1; i<=doc.numPages; i++) {
    const page = await doc.getPage(i);
    const text = await page.getTextContent().catch(()=>null);
    if (text?.items?.length) {
      const viewport = page.getViewport({ scale: 1 });
      const items = text.items.map(it => ({
        text: it.str,
        bbox: rectFromTransform(it.transform, it.width, it.height, viewport.height),
        page: i
      }));
      pages.push({ page: i, mode: 'text', items, width: viewport.width, height: viewport.height });
    } else {
      const scale = (dpi / 72);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width | 0;
      canvas.height = viewport.height | 0;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      await page.render({ canvasContext: ctx, viewport }).promise;
      const blob = await new Promise(r => canvas.toBlob(r, 'image/png', 0.92));
      pages.push({ page: i, mode: 'image', blob, width: canvas.width, height: canvas.height });
    }
  }
  return { numPages: doc.numPages, pages };
}

function rectFromTransform(tr, w, h, pageHeight) {
  const x = tr[4], y = tr[5];
  return [x, pageHeight - y - h, x + w, pageHeight - y];
}

async function loadPdfJs() {
  const base = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4';
  const workerUrl = `${base}/build/pdf.worker.min.mjs`;
  const mainUrl = `${base}/build/pdf.min.mjs`;
  const mod = await import(/* @vite-ignore */ mainUrl);
  mod.GlobalWorkerOptions.workerSrc = workerUrl;
  return mod;
}
