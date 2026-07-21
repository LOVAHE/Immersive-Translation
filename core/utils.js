import { api, callApi } from './browser.js';

export async function createContextMenus(items) {
  await callApi(api.contextMenus.removeAll.bind(api.contextMenus));
  items.forEach(item => api.contextMenus.create(item));
}

export async function withTimeout(promise, ms = 25000) {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error('Request timed out')), ms);
  });
  try {
    const res = await Promise.race([promise, timeout]);
    return res;
  } finally {
    clearTimeout(t);
  }
}

export function createAbortError(signal, fallback = 'Translation cancelled.') {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error(fallback);
  error.name = 'AbortError';
  error.code = 'TRANSLATION_CANCELLED';
  return error;
}

export function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof signal.throwIfAborted === 'function') signal.throwIfAborted();
  throw createAbortError(signal);
}

export function isAbortError(error, signal) {
  return signal?.aborted === true
    || error?.name === 'AbortError'
    || error?.code === 'TRANSLATION_CANCELLED';
}
