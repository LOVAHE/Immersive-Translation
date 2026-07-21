import { textItemToViewportRect } from './layout.js';

let pdfjsLibPromise = null;

function abortError() {
  return new DOMException('The PDF operation was cancelled.', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || abortError();
}

async function getTextContentWithSignal(page, signal) {
  throwIfAborted(signal);
  if (typeof page.streamTextContent !== 'function') {
    const content = await page.getTextContent({ includeMarkedContent: true });
    throwIfAborted(signal);
    return content;
  }

  const stream = page.streamTextContent({ includeMarkedContent: true });
  const reader = stream.getReader();
  const content = { items: [], styles: Object.create(null), lang: null };
  const cancel = () => reader.cancel(signal?.reason || abortError()).catch(() => {});
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const { value, done } = await reader.read();
      if (done) break;
      if (Array.isArray(value?.items)) content.items.push(...value.items);
      if (value?.styles) Object.assign(content.styles, value.styles);
      if (value?.lang) content.lang = value.lang;
    }
    throwIfAborted(signal);
    return content;
  } finally {
    signal?.removeEventListener('abort', cancel);
    try { reader.releaseLock(); } catch { /* The stream may already be cancelled. */ }
  }
}

async function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = (async () => {
      const api = globalThis.browser ?? globalThis.chrome;
      if (!api?.runtime?.getURL) throw new Error('The PDF reader must run inside the extension.');
      const workerUrl = api.runtime.getURL('vendor/pdf.worker.min.mjs');
      const mainUrl = api.runtime.getURL('vendor/pdf.min.mjs');
      const moduleNamespace = await import(/* @vite-ignore */ mainUrl);
      moduleNamespace.GlobalWorkerOptions.workerSrc = workerUrl;
      return moduleNamespace;
    })();
  }
  return pdfjsLibPromise;
}

function canvasSize(canvas, viewport, outputScale) {
  const cssWidth = Math.max(1, viewport.width);
  const cssHeight = Math.max(1, viewport.height);
  canvas.width = Math.max(1, Math.floor(cssWidth * outputScale));
  canvas.height = Math.max(1, Math.floor(cssHeight * outputScale));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
}

function normalizeTextItems(textContent, viewport) {
  return (textContent?.items || [])
    .filter(item => typeof item?.str === 'string' && item.str.trim())
    .map((item, index) => ({
      id: `pdf-text-${index}`,
      text: item.str,
      bbox: textItemToViewportRect(item, viewport),
      hasEol: !!item.hasEOL,
      direction: item.dir || 'ltr'
    }));
}

/**
 * Open a PDF without rasterizing every page. The returned facade keeps PDF.js
 * internals behind a small cancellable API so the viewer can render only pages
 * near the viewport.
 */
export async function openPdfDocument({ arrayBuffer, password, onProgress, signal } = {}) {
  if (!(arrayBuffer instanceof ArrayBuffer)) throw new TypeError('A PDF ArrayBuffer is required.');
  throwIfAborted(signal);
  const pdfjsLib = await loadPdfJs();
  throwIfAborted(signal);
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer, password: password || undefined });
  if (typeof onProgress === 'function') loadingTask.onProgress = onProgress;
  const cancelLoading = () => {
    try { Promise.resolve(loadingTask.destroy()).catch(() => {}); }
    catch { /* A concurrently completed load no longer needs cancellation. */ }
  };
  signal?.addEventListener('abort', cancelLoading, { once: true });
  let documentProxy;
  try {
    documentProxy = await loadingTask.promise;
    throwIfAborted(signal);
  } catch (error) {
    if (signal?.aborted) throw signal.reason || abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancelLoading);
  }
  const pageCache = new Map();
  let destroyed = false;

  async function getPage(pageNumber) {
    if (destroyed) throw new Error('The PDF document is closed.');
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > documentProxy.numPages) {
      throw new RangeError(`PDF page ${pageNumber} is outside the document.`);
    }
    if (!pageCache.has(pageNumber)) pageCache.set(pageNumber, documentProxy.getPage(pageNumber));
    return pageCache.get(pageNumber);
  }

  async function getPageInfo(pageNumber, scale = 1) {
    const page = await getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    return { pageNumber, width: viewport.width, height: viewport.height, rotation: viewport.rotation };
  }

  async function renderPage({ pageNumber, canvas, scale = 1, signal, outputScale } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError('A canvas is required to render a PDF page.');
    throwIfAborted(signal);
    const page = await getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const pixelRatio = Math.min(2, Math.max(1, Number(outputScale) || globalThis.devicePixelRatio || 1));
    canvasSize(canvas, viewport, pixelRatio);
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    context.save();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();

    const renderTask = page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio === 1 ? null : [pixelRatio, 0, 0, pixelRatio, 0, 0]
    });
    const cancel = () => renderTask.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await renderTask.promise;
      throwIfAborted(signal);
      const textContent = await getTextContentWithSignal(page, signal);
      throwIfAborted(signal);
      return {
        pageNumber,
        viewport,
        outputScale: pixelRatio,
        textContent,
        items: normalizeTextItems(textContent, viewport)
      };
    } catch (error) {
      if (signal?.aborted || error?.name === 'RenderingCancelledException') throw signal?.reason || abortError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  async function renderTextLayer({ pageNumber, container, viewport, textContent, signal } = {}) {
    if (!(container instanceof HTMLElement)) throw new TypeError('A text layer container is required.');
    throwIfAborted(signal);
    const page = await getPage(pageNumber);
    const source = textContent || await getTextContentWithSignal(page, signal);
    container.replaceChildren();
    container.style.width = `${viewport.width}px`;
    container.style.height = `${viewport.height}px`;

    const textLayer = new pdfjsLib.TextLayer({ textContentSource: source, container, viewport });
    const cancel = () => textLayer.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await textLayer.render();
      throwIfAborted(signal);
    } catch (error) {
      if (signal?.aborted) throw signal.reason || abortError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    pageCache.clear();
    await loadingTask.destroy();
  }

  function releasePage(pageNumber) {
    const page = pageCache.get(pageNumber);
    if (!page) return;
    pageCache.delete(pageNumber);
    Promise.resolve(page).then(proxy => proxy.cleanup()).catch(() => {});
  }

  return {
    numPages: documentProxy.numPages,
    getPageInfo,
    renderPage,
    renderTextLayer,
    releasePage,
    destroy
  };
}
