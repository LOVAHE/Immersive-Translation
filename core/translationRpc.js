import { api } from './browser.js';
import { normalizeTranslationRequestId } from './translationRequests.js';
import { createAbortError, throwIfAborted } from './utils.js';

let requestSequence = 0;

export function createTranslationRequestId(prefix = 'translation') {
  const safePrefix = String(prefix || 'translation')
    .replace(/[^A-Za-z0-9._:-]/g, '-')
    .slice(0, 40) || 'translation';
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${++requestSequence}`;
  return normalizeTranslationRequestId(`${safePrefix}-${suffix}`);
}

export function cancelTranslationRequest(requestId, runtimeApi = api) {
  if (!runtimeApi?.runtime?.sendMessage) return Promise.resolve(false);
  try {
    return Promise.resolve(runtimeApi.runtime.sendMessage({
      action: 'cancelTranslation',
      requestId
    })).then(response => response?.cancelled === true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function closeTranslationContext(contextId, runtimeApi = api) {
  let normalized;
  try {
    normalized = normalizeTranslationRequestId(contextId);
  } catch {
    return Promise.resolve(false);
  }
  if (!runtimeApi?.runtime?.sendMessage) return Promise.resolve(false);
  try {
    return Promise.resolve(runtimeApi.runtime.sendMessage({
      action: 'closeTranslationContext',
      contextId: normalized
    })).then(response => response?.closed === true, () => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function sendCancellableTranslation(
  message,
  { signal, prefix = 'translation', runtimeApi = api } = {}
) {
  if (!runtimeApi?.runtime?.sendMessage) {
    return Promise.reject(new Error('Browser extension messaging is unavailable.'));
  }
  throwIfAborted(signal);
  const requestId = createTranslationRequestId(prefix);
  let pending;
  try {
    pending = Promise.resolve(runtimeApi.runtime.sendMessage({
      ...message,
      action: 'translateText',
      requestId
    }));
  } catch (error) {
    return Promise.reject(error);
  }
  if (!signal) return pending;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      void cancelTranslationRequest(requestId, runtimeApi);
      finish(reject, createAbortError(signal));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    pending.then(
      response => finish(resolve, response),
      error => finish(reject, error)
    );
  });
}
