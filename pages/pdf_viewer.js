import { createBatchPayload, splitBatchTranslation } from '../core/batchTranslation.js';
import { consumePdfRequest } from '../core/pdfHandoff.js';
import { initI18n, t } from '../core/i18n.js';
import { getSettings } from '../core/settings.js';
import {
  closeTranslationContext,
  createTranslationRequestId,
  sendCancellableTranslation
} from '../core/translationRpc.js';
import {
  acquireOcrTask,
  createOcrEngine,
  discardCancelledOcrTask
} from '../ocr/tesseract.js';
import { openPdfDocument } from '../pdf/extract.js';
import {
  chunkPdfParagraphs,
  groupPdfTextItems,
  isUsablePdfText,
  layoutPdfTranslationParagraphs
} from '../pdf/layout.js';
import {
  activatePdfPageState,
  deactivatePdfPageState,
  disposePdfPageState
} from '../pdf/pageLifecycle.js';
import { readPdfResponse } from '../pdf/source.js';

const api = globalThis.browser ?? globalThis.chrome;
const scrollHost = document.getElementById('pdf-scroll');
const documentHost = document.getElementById('pdf-document');
const pageTemplate = document.getElementById('pdf-page-template');
const statusElement = document.getElementById('pdf-status');
const retryDocumentButton = document.getElementById('pdf-retry-document');
const pageInput = document.getElementById('pdf-page-number');
const pageCount = document.getElementById('pdf-page-count');
const previousButton = document.getElementById('pdf-prev');
const nextButton = document.getElementById('pdf-next');
const zoomButton = document.getElementById('pdf-zoom');
const modeButton = document.getElementById('pdf-mode');

const states = [];
let settings = null;
let pdfDocument = null;
let pdfRequest = null;
let documentController = null;
let scale = 1;
let currentPage = 1;
let documentGeneration = 0;
let translationContextId = null;
let pdfBfCacheSuspended = false;
let scrollFrame = 0;
const MAX_PDF_BYTES = 100 * 1024 * 1024;

const pageObserver = new IntersectionObserver(entries => {
  if (pdfBfCacheSuspended) return;
  for (const entry of entries) {
    const state = states.find(candidate => candidate.host === entry.target);
    if (!state) continue;
    if (entry.isIntersecting) {
      activatePdfPageState(state, schedulePage);
    } else if (!state.disposeTimer) {
      deactivatePdfPageState(state);
      state.disposeTimer = setTimeout(() => {
        disposePdfPageState(state, pageNumber => pdfDocument?.releasePage(pageNumber));
        discardCancelledOcrTask(state);
      }, 15_000);
      state.disposeTimer?.unref?.();
    }
  }
}, { root: scrollHost, rootMargin: '120% 0px', threshold: 0.01 });

class TaskQueue {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.waiting = [];
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.waiting.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.active < this.limit && this.waiting.length) {
      const item = this.waiting.shift();
      this.active += 1;
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const renderQueue = new TaskQueue(2);
const translationQueue = new TaskQueue(1);
const ocrEngine = createOcrEngine();

function message(key, fallback) {
  const configured = t(key);
  return configured !== key ? configured : (api.i18n?.getMessage?.(key) || fallback);
}

function localizeChrome() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const translated = t(element.dataset.i18n);
    if (translated !== element.dataset.i18n) element.textContent = translated;
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    const translated = t(element.dataset.i18nAriaLabel);
    if (translated !== element.dataset.i18nAriaLabel) element.setAttribute('aria-label', translated);
  });
}

function setStatus(text, { retry = false } = {}) {
  statusElement.textContent = text;
  retryDocumentButton.hidden = !retry;
}

function readableError(error) {
  if (error?.name === 'AbortError') return '';
  const text = String(error?.message || error || '').replace(/https?:\/\/\S+/g, '').trim();
  return text || message('pdfUnknownError', 'Unable to open this PDF.');
}

function showPageMessage(state, text, { retry = false } = {}) {
  const host = state.message;
  host.replaceChildren();
  host.dataset.visible = text ? 'true' : 'false';
  if (!text) return;
  const content = document.createElement('div');
  const label = document.createElement('div');
  label.textContent = text;
  content.appendChild(label);
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = message('retryTranslation', 'Retry');
    button.addEventListener('click', () => {
      state.status = 'idle';
      schedulePage(state);
    });
    content.appendChild(button);
  }
  host.appendChild(content);
}

function updateNavigation() {
  pageInput.value = String(currentPage);
  previousButton.disabled = currentPage <= 1;
  nextButton.disabled = !pdfDocument || currentPage >= pdfDocument.numPages;
}

function updateCurrentPageFromScroll() {
  scrollFrame = 0;
  if (!states.length) return;
  const reference = scrollHost.getBoundingClientRect().top + 20;
  let nearest = states[0];
  let distance = Infinity;
  for (const state of states) {
    const nextDistance = Math.abs(state.host.getBoundingClientRect().top - reference);
    if (nextDistance < distance) {
      distance = nextDistance;
      nearest = state;
    }
  }
  currentPage = nearest.pageNumber;
  updateNavigation();
}

function scrollToPage(pageNumber) {
  const next = Math.min(states.length, Math.max(1, Math.floor(Number(pageNumber) || 1)));
  const state = states[next - 1];
  if (!state) return;
  currentPage = next;
  updateNavigation();
  state.host.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function fetchPdfSource(src, externalSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('PDF download timed out.', 'TimeoutError')), 60_000);
  const forwardAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) forwardAbort();
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true });
  try {
    const response = await fetch(src, { credentials: 'include', signal: controller.signal });
    return await readPdfResponse(response, { maxBytes: MAX_PDF_BYTES, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('The PDF operation was cancelled.', 'AbortError');
}

function waitForAbortable(promise, signal, onAbort = () => {}) {
  if (signal?.aborted) {
    onAbort();
    return Promise.reject(abortReason(signal));
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      try { onAbort(); } catch { /* Cancellation is best-effort. */ }
      reject(abortReason(signal));
    };
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal?.removeEventListener('abort', abort);
    });
  });
}

function createPageState(pageNumber, info) {
  const fragment = pageTemplate.content.cloneNode(true);
  const host = fragment.querySelector('.spread');
  const sourcePage = fragment.querySelector('.source-page');
  const translationPage = fragment.querySelector('.translation-page');
  const sourceCanvas = sourcePage.querySelector('canvas');
  const targetCanvas = translationPage.querySelector('canvas');
  const textLayer = fragment.querySelector('.text-layer');
  const translationLayer = fragment.querySelector('.translation-layer');
  const pageMessage = fragment.querySelector('.page-message');
  const labels = fragment.querySelectorAll('.page-label');
  host.setAttribute('aria-label', `${message('pdfPagePair', 'PDF page pair')} ${pageNumber}`);
  labels[0].textContent = `${message('pdfOriginal', 'Original')} · ${pageNumber}`;
  labels[1].textContent = `${message('pdfTranslation', 'Translation')} · ${pageNumber}`;
  host.dataset.pageNumber = String(pageNumber);
  sourcePage.style.width = `${info.width}px`;
  sourcePage.style.height = `${info.height}px`;
  translationPage.style.width = `${info.width}px`;
  translationPage.style.height = `${info.height}px`;
  documentHost.appendChild(fragment);

  return {
    pageNumber,
    baseWidth: info.width / scale,
    baseHeight: info.height / scale,
    host,
    sourcePage,
    translationPage,
    sourceCanvas,
    targetCanvas,
    textLayer,
    translationLayer,
    message: pageMessage,
    status: 'idle',
    generation: 0,
    controller: null,
    disposeTimer: null
  };
}

function copyCanvas(source, target) {
  target.width = source.width;
  target.height = source.height;
  target.style.width = source.style.width;
  target.style.height = source.style.height;
  const context = target.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0);
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('Unable to read the rendered PDF page.')),
    'image/png'
  ));
}

function ocrParagraphs(words, outputScale) {
  const ratio = Math.max(1, outputScale || 1);
  const items = words.map((word, index) => ({
    id: `pdf-ocr-${index}`,
    text: word.text,
    bbox: word.bbox.map(value => value / ratio)
  }));
  return groupPdfTextItems(items);
}

function scaleParagraphs(paragraphs, factor) {
  return paragraphs.map(paragraph => ({
    ...paragraph,
    bbox: paragraph.bbox.map(value => value * factor)
  }));
}

async function paragraphsForPage(rendered, state, signal, renderScale) {
  if (isUsablePdfText(rendered.items)) return groupPdfTextItems(rendered.items);
  if (!settings.ocrEnabled || settings.ocrEngine !== 'tesseract') return [];
  if (state.ocrCache) return scaleParagraphs(state.ocrCache, renderScale);

  showPageMessage(state, message('pdfRecognizing', 'Recognizing page text…'));
  let task = state.ocrTask;
  if (!task) {
    const blob = await waitForAbortable(canvasBlob(state.sourceCanvas), signal);
    if (signal.aborted) throw signal.reason;
    if (state.ocrCache) return scaleParagraphs(state.ocrCache, renderScale);
    const languages = String(settings.ocrLangs || 'eng').split(',').map(value => value.trim()).filter(Boolean);
    task = acquireOcrTask(state, signal, onStart => (
      ocrEngine.recognize(blob, languages, signal, { onStart }).then(result => {
        const paragraphs = ocrParagraphs(result.words || [], rendered.outputScale);
        const baseParagraphs = scaleParagraphs(paragraphs, 1 / renderScale);
        state.ocrCache = baseParagraphs;
        return baseParagraphs;
      })
    ));
  }

  // The current render stops immediately on abort. If Tesseract already
  // started, task.promise continues safely and populates the lightweight cache
  // for a later render; if still queued, the engine rejects it before worker use.
  const baseParagraphs = await waitForAbortable(task.promise, signal);
  if (signal.aborted) throw signal.reason;
  return scaleParagraphs(baseParagraphs, renderScale);
}

async function translateParagraphs(paragraphs, targetLang, signal) {
  const translations = new Map();
  for (const chunk of chunkPdfParagraphs(paragraphs, { maxItems: 20, maxChars: 4500 })) {
    if (signal.aborted) throw signal.reason;
    const response = await sendCancellableTranslation({
      text: createBatchPayload(chunk.map(paragraph => paragraph.text)),
      sourceLang: settings.sourceLang || 'auto',
      targetLang,
      intent: 'pdf',
      contextId: translationContextId
    }, { signal, prefix: `pdf-page` });
    if (!response?.ok) throw new Error(response?.error || 'PDF translation failed.');
    const split = splitBatchTranslation(response.result?.translated || '', chunk.length);
    if (!split.matched || split.items.some(value => !String(value || '').trim())) {
      throw new Error('The translation service returned an incomplete PDF page.');
    }
    chunk.forEach((paragraph, index) => translations.set(paragraph.id, split.items[index].trim()));
  }
  return translations;
}

function renderTranslationLayer(state, paragraphs, translations) {
  const fragment = document.createDocumentFragment();
  const fitted = [];
  const pageWidth = Number.parseFloat(state.translationPage.style.width) || state.baseWidth * scale;
  const pageHeight = Number.parseFloat(state.translationPage.style.height) || state.baseHeight * scale;
  const regions = layoutPdfTranslationParagraphs(paragraphs, { pageWidth, pageHeight });
  for (const region of regions) {
    const { paragraph } = region;
    const translated = translations.get(paragraph.id);
    if (!translated) continue;
    const preferredFontSize = Math.max(7, Math.min(18, region.sourceHeight * 0.72));
    const element = document.createElement('div');
    element.className = 'translated-paragraph';
    element.tabIndex = 0;
    element.lang = settings.targetLang || '';
    element.title = paragraph.text;
    element.textContent = translated;
    Object.assign(element.style, {
      left: `${region.x}px`,
      top: `${region.y}px`,
      width: `${region.width}px`,
      height: `${region.sourceHeight}px`,
      fontFamily: settings.translationFontFamily || 'system-ui, sans-serif',
      fontSize: `${preferredFontSize}px`,
      color: settings.translationTextColor || '#111827'
    });
    fragment.appendChild(element);
    fitted.push({ element, region, preferredFontSize });
  }
  state.translationLayer.replaceChildren(fragment);
  for (const { element, region, preferredFontSize } of fitted) {
    const desiredHeight = Math.min(region.maxHeight, Math.max(region.sourceHeight, element.scrollHeight + 2));
    element.style.height = `${desiredHeight}px`;
    let fontSize = preferredFontSize;
    while ((element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth) && fontSize > 6) {
      fontSize = Math.max(6, fontSize - 0.5);
      element.style.fontSize = `${fontSize}px`;
    }
    const overflow = element.scrollHeight > element.clientHeight || element.scrollWidth > element.clientWidth;
    element.dataset.overflow = String(overflow);
  }
}

async function renderPageState(state, expectedDocumentGeneration, pageGeneration) {
  if (expectedDocumentGeneration !== documentGeneration || pageGeneration !== state.generation) return;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  const { signal } = controller;
  const renderScale = scale;
  const isCurrent = () => (
    expectedDocumentGeneration === documentGeneration
    && pageGeneration === state.generation
    && state.controller === controller
  );
  state.status = 'rendering';
  showPageMessage(state, message('pdfRendering', 'Rendering page…'));

  try {
    const rendered = await pdfDocument.renderPage({
      pageNumber: state.pageNumber,
      canvas: state.sourceCanvas,
      scale: renderScale,
      signal
    });
    if (!isCurrent()) return;

    state.baseWidth = rendered.viewport.width / renderScale;
    state.baseHeight = rendered.viewport.height / renderScale;
    state.sourcePage.style.width = `${rendered.viewport.width}px`;
    state.sourcePage.style.height = `${rendered.viewport.height}px`;
    state.translationPage.style.width = `${rendered.viewport.width}px`;
    state.translationPage.style.height = `${rendered.viewport.height}px`;
    copyCanvas(state.sourceCanvas, state.targetCanvas);
    await pdfDocument.renderTextLayer({
      pageNumber: state.pageNumber,
      container: state.textLayer,
      viewport: rendered.viewport,
      textContent: rendered.textContent,
      signal
    });
    if (!isCurrent()) return;

    const paragraphs = await paragraphsForPage(rendered, state, signal, renderScale);
    if (!isCurrent()) return;
    if (!paragraphs.length) {
      state.status = 'ready';
      showPageMessage(state, message('pdfNoText', 'No translatable text was found on this page.'));
      return;
    }

    showPageMessage(state, message('pdfTranslating', 'Translating page…'));
    const translationKey = JSON.stringify(paragraphs.map(paragraph => paragraph.text));
    const targetLang = settings.targetLang || 'zh';
    let translations;
    if (state.translationCache?.key === translationKey && state.translationCache.targetLang === targetLang) {
      translations = state.translationCache.translations;
    } else {
      translations = await translationQueue.run(() => translateParagraphs(paragraphs, targetLang, signal));
      if (!isCurrent()) return;
      state.translationCache = { key: translationKey, targetLang, translations };
    }
    if (!isCurrent()) return;
    renderTranslationLayer(state, paragraphs, translations);
    state.status = 'ready';
    showPageMessage(state, '');
    setStatus(message('pdfReady', 'PDF translation is ready.'));
  } catch (error) {
    if (error?.name === 'AbortError' || signal.aborted || !isCurrent()) return;
    state.status = 'error';
    showPageMessage(state, readableError(error), { retry: true });
  } finally {
    if (state.controller === controller) state.controller = null;
  }
}

function schedulePage(state) {
  if (pdfBfCacheSuspended || !pdfDocument || state.status !== 'idle') return;
  state.status = 'queued';
  const generation = documentGeneration;
  const pageGeneration = ++state.generation;
  renderQueue.run(() => renderPageState(state, generation, pageGeneration)).catch(error => {
    if (error?.name !== 'AbortError' && generation === documentGeneration && pageGeneration === state.generation) {
      state.status = 'error';
      showPageMessage(state, readableError(error), { retry: true });
    }
  });
}

function scheduleVisiblePages() {
  if (pdfBfCacheSuspended || !pdfDocument) return;
  const viewport = scrollHost.getBoundingClientRect();
  for (const state of states) {
    const box = state.host.getBoundingClientRect();
    if (box.bottom >= viewport.top - viewport.height && box.top <= viewport.bottom + viewport.height) {
      schedulePage(state);
    }
  }
}

async function rebuildPages(nextScale) {
  if (pdfBfCacheSuspended || !pdfDocument) return;
  const requestedScale = Math.min(2.5, Math.max(0.5, nextScale));
  scale = requestedScale;
  const rebuildGeneration = ++documentGeneration;
  zoomButton.textContent = `${Math.round(scale * 100)}%`;

  for (const state of states) {
    state.controller?.abort();
    state.generation += 1;
    state.status = 'idle';
    state.translationLayer.replaceChildren();
    state.textLayer.replaceChildren();
    if (rebuildGeneration !== documentGeneration) return;
    const width = state.baseWidth * requestedScale;
    const height = state.baseHeight * requestedScale;
    state.sourcePage.style.width = `${width}px`;
    state.sourcePage.style.height = `${height}px`;
    state.translationPage.style.width = `${width}px`;
    state.translationPage.style.height = `${height}px`;
    showPageMessage(state, '');
  }

  scheduleVisiblePages();
}

async function fitWidth() {
  if (pdfBfCacheSuspended || !pdfDocument) return;
  const base = await pdfDocument.getPageInfo(currentPage, 1);
  if (pdfBfCacheSuspended || !pdfDocument) return;
  const bilingual = document.body.dataset.mode !== 'translation';
  const available = scrollHost.clientWidth - 72 - (bilingual ? 20 : 0);
  const pageWidth = bilingual ? available / 2 : available;
  await rebuildPages(pageWidth / base.width);
}

async function openRequestedPdf(signal) {
  settings = await getSettings();
  if (signal.aborted) throw abortReason(signal);
  document.documentElement.lang = await initI18n(settings.uiLang || 'en');
  localizeChrome();
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('error') === 'permission') {
    throw new Error(message('pdfPermissionDenied', 'Allow access to the PDF origin, then open it again.'));
  }
  const requestId = hash.get('request');
  if (!requestId) throw new Error(message('pdfOpenFromMenu', 'Open a PDF from the extension context menu.'));
  if (!pdfRequest) pdfRequest = await consumePdfRequest(requestId);
  setStatus(message('pdfDownloading', 'Downloading PDF…'));
  const arrayBuffer = await fetchPdfSource(pdfRequest.src, signal);
  setStatus(message('pdfOpening', 'Opening PDF…'));
  const openedDocument = await openPdfDocument({
    arrayBuffer,
    signal,
    onProgress: progress => {
      if (progress?.total) setStatus(`${message('pdfDownloading', 'Downloading PDF…')} ${Math.round(progress.loaded / progress.total * 100)}%`);
    }
  });
  if (signal.aborted) {
    await openedDocument.destroy().catch(() => {});
    throw abortReason(signal);
  }
  pdfDocument = openedDocument;

  pageCount.textContent = String(pdfDocument.numPages);
  pageInput.max = String(pdfDocument.numPages);
  // Read only the first page while building placeholders. Each page corrects
  // its own dimensions when it enters the lazy-render window, avoiding an
  // eager getPage() sweep over large documents.
  const placeholderInfo = await pdfDocument.getPageInfo(1, scale);
  if (signal.aborted) throw abortReason(signal);
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const state = createPageState(pageNumber, placeholderInfo);
    states.push(state);
    pageObserver.observe(state.host);
  }
  updateNavigation();
  setStatus(message('pdfTranslating', 'Translating visible pages…'));
  if (states[0]) schedulePage(states[0]);
}

async function start() {
  const previousTranslationContextId = translationContextId;
  documentController?.abort();
  const nextDocumentController = new AbortController();
  documentController = nextDocumentController;
  const previousDocument = pdfDocument;
  pdfDocument = null;
  const startGeneration = ++documentGeneration;
  translationContextId = createTranslationRequestId('pdf-context');
  for (const state of states.splice(0)) {
    pageObserver.unobserve(state.host);
    if (state.disposeTimer) clearTimeout(state.disposeTimer);
    state.generation += 1;
    state.controller?.abort();
  }
  if (previousTranslationContextId) void closeTranslationContext(previousTranslationContextId);
  retryDocumentButton.hidden = true;
  documentHost.replaceChildren();
  if (previousDocument) await previousDocument.destroy().catch(() => {});
  if (
    nextDocumentController.signal.aborted
    || documentController !== nextDocumentController
    || documentGeneration !== startGeneration
  ) return;
  try {
    await openRequestedPdf(nextDocumentController.signal);
  } catch (error) {
    if (nextDocumentController.signal.aborted || documentController !== nextDocumentController) return;
    setStatus(readableError(error), { retry: true });
  }
}

function closeCurrentPdfTranslationContext() {
  const contextId = translationContextId;
  translationContextId = null;
  if (contextId) void closeTranslationContext(contextId);
}

function suspendPdfForBfCache() {
  if (pdfBfCacheSuspended) return;
  pdfBfCacheSuspended = true;
  documentGeneration += 1;
  documentController?.abort();
  documentController = null;
  for (const state of states) {
    if (state.disposeTimer) clearTimeout(state.disposeTimer);
    state.disposeTimer = null;
    deactivatePdfPageState(state);
  }
  closeCurrentPdfTranslationContext();
}

function resumePdfFromBfCache() {
  if (!pdfBfCacheSuspended) return;
  pdfBfCacheSuspended = false;
  // If the page was cached while the document proxy was open but before its
  // page placeholders were committed, restart the open transaction instead
  // of resuming a half-initialized viewer.
  if (!pdfDocument || !states.length) {
    void start();
    return;
  }
  translationContextId = createTranslationRequestId('pdf-context');
  setStatus(message('pdfTranslating', 'Translating visible pages…'));
  scheduleVisiblePages();
}

previousButton.addEventListener('click', () => scrollToPage(currentPage - 1));
nextButton.addEventListener('click', () => scrollToPage(currentPage + 1));
pageInput.addEventListener('change', () => scrollToPage(pageInput.value));
document.getElementById('pdf-zoom-out').addEventListener('click', () => rebuildPages(scale - 0.1));
document.getElementById('pdf-zoom-in').addEventListener('click', () => rebuildPages(scale + 0.1));
zoomButton.addEventListener('click', fitWidth);
modeButton.addEventListener('click', async () => {
  const translationOnly = document.body.dataset.mode !== 'translation';
  document.body.dataset.mode = translationOnly ? 'translation' : 'bilingual';
  modeButton.setAttribute('aria-pressed', String(translationOnly));
  modeButton.textContent = translationOnly
    ? message('pdfShowBilingual', 'Show bilingual')
    : message('pdfBilingual', 'Bilingual');
});
retryDocumentButton.addEventListener('click', () => start());
scrollHost.addEventListener('scroll', () => {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateCurrentPageFromScroll);
}, { passive: true });

addEventListener('beforeunload', () => {
  documentController?.abort();
  pageObserver.disconnect();
  states.forEach(state => {
    if (state.disposeTimer) clearTimeout(state.disposeTimer);
    state.controller?.abort();
  });
  closeCurrentPdfTranslationContext();
  ocrEngine.terminate().catch(() => {});
  pdfDocument?.destroy().catch(() => {});
});
addEventListener('pagehide', event => {
  if (event.persisted) suspendPdfForBfCache();
});
addEventListener('pageshow', event => {
  if (event.persisted) resumePdfFromBfCache();
});

document.body.dataset.mode = 'bilingual';
start();
