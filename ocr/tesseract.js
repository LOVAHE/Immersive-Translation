export const OCR_LANGUAGE_DATA_BASE_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';

export function createTesseractWorkerOptions(api) {
  return {
    workerPath: api.runtime.getURL('vendor/worker.min.js'),
    corePath: api.runtime.getURL('vendor/tesseract-core.wasm.js'),
    logger: () => {}
  };
}

export function resolveTesseractModule(moduleNamespace, globalScope = globalThis) {
  const candidates = [
    moduleNamespace?.default,
    moduleNamespace,
    globalScope?.Tesseract
  ];
  const runtime = candidates.find(candidate => typeof candidate?.createWorker === 'function');

  if (!runtime) {
    throw new Error('Bundled Tesseract runtime did not expose createWorker().');
  }
  return runtime;
}

async function loadBundledTesseract() {
  const api = globalThis.browser ?? globalThis.chrome;
  const url = api.runtime.getURL('vendor/tesseract.min.js');
  const moduleNamespace = await import(/* @vite-ignore */ url);
  return resolveTesseractModule(moduleNamespace, globalThis);
}

function normalizeLanguages(langs) {
  const values = Array.isArray(langs) ? langs : [langs];
  return values.map(lang => String(lang || '').trim()).filter(Boolean).join('+') || 'eng';
}

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException('OCR was cancelled before recognition started.', 'AbortError');
}

/**
 * Keep one recognition task per PDF page. A render cancellation may discard a
 * queued task, but an already-started Tesseract call remains reusable because
 * the worker cannot safely interrupt it.
 */
export function acquireOcrTask(state, signal, start) {
  const existing = state?.ocrTask;
  if (existing && !(existing.cancelled && !existing.started)) return existing;

  const task = {
    started: false,
    cancelled: Boolean(signal?.aborted),
    promise: null
  };
  const markStarted = () => {
    task.started = true;
  };
  const handleAbort = () => {
    task.cancelled = true;
    if (!task.started && state.ocrTask === task) state.ocrTask = null;
  };

  state.ocrTask = task;
  if (signal?.aborted) handleAbort();
  else signal?.addEventListener('abort', handleAbort, { once: true });

  try {
    task.promise = Promise.resolve(start(markStarted));
  } catch (error) {
    task.promise = Promise.reject(error);
  }

  const settle = () => {
    signal?.removeEventListener('abort', handleAbort);
    if (state.ocrTask === task) state.ocrTask = null;
  };
  // Both branches resolve the ignored continuation, so a rejected OCR promise
  // cannot produce an unhandled rejection through a dangling finally().
  void task.promise.then(settle, settle);
  return task;
}

export function discardCancelledOcrTask(state) {
  const task = state?.ocrTask;
  if (task?.cancelled && !task.started) state.ocrTask = null;
}

export function createOcrEngine({
  api = globalThis.browser ?? globalThis.chrome,
  loadTesseract = loadBundledTesseract
} = {}) {
  let workerPromise = null;
  let workerLanguage = '';
  let operationQueue = Promise.resolve();

  function enqueue(operation, signal, onStart = () => {}) {
    let started = false;
    let skipped = false;
    let settled = false;
    let resolveResult;
    let rejectResult;
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const abort = () => {
      if (started || settled) return;
      skipped = true;
      settled = true;
      rejectResult(abortReason(signal));
    };

    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });

    const queueStep = operationQueue.then(async () => {
      if (skipped) return;
      if (signal?.aborted) {
        abort();
        return;
      }

      started = true;
      signal?.removeEventListener('abort', abort);
      try {
        onStart();
        const value = await operation();
        if (!settled) {
          settled = true;
          resolveResult(value);
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          rejectResult(error);
        }
      }
    });
    operationQueue = queueStep.catch(() => {});
    return result;
  }

  async function getWorker(language) {
    if (workerPromise && workerLanguage === language) return workerPromise;

    if (workerPromise) {
      const previousWorkerPromise = workerPromise;
      workerPromise = null;
      workerLanguage = '';
      const previousWorker = await previousWorkerPromise;
      await previousWorker.terminate();
    }

    const pendingWorker = (async () => {
      const Tesseract = await loadTesseract();
      return Tesseract.createWorker(language, 1, createTesseractWorkerOptions(api));
    })();
    workerPromise = pendingWorker;
    workerLanguage = language;

    try {
      return await pendingWorker;
    } catch (error) {
      if (workerPromise === pendingWorker) {
        workerPromise = null;
        workerLanguage = '';
      }
      throw error;
    }
  }

  function recognize(blob, langs = ['eng'], signal, { onStart } = {}) {
    const language = normalizeLanguages(langs);
    return enqueue(async () => {
      const worker = await getWorker(language);
      const { data } = await worker.recognize(blob, {});
      return {
        text: data.text,
        words: (data.words || []).map(word => ({
          text: word.text,
          bbox: [word.bbox.x0, word.bbox.y0, word.bbox.x1, word.bbox.y1]
        }))
      };
    }, signal, onStart);
  }

  function terminate() {
    return enqueue(async () => {
      if (!workerPromise) return;

      const currentWorkerPromise = workerPromise;
      workerPromise = null;
      workerLanguage = '';
      const worker = await currentWorkerPromise;
      await worker.terminate();
    });
  }

  return { recognize, terminate };
}

let defaultEngine = null;

export function ocrImageBlob(blob, langs = ['eng'], signal) {
  if (!defaultEngine) defaultEngine = createOcrEngine();
  return defaultEngine.recognize(blob, langs, signal);
}
