import { api, callApi } from './browser.js';
import { createAbortError, throwIfAborted } from './utils.js';

export const CODEX_NATIVE_HOST = 'com.adaptive_translation.codex';
export const CODEX_NATIVE_PROTOCOL_VERSION = 2;
export const CODEX_NATIVE_SECURITY_PROFILE = 'isolated-chatgpt-v2';

let nativePort = null;
let sequence = 0;
let idleTimer = null;
let compatibleHealthPromise = null;
let compatibleHealthPort = null;
let compatibleHealthReady = false;
const pending = new Map();
const IDLE_DISCONNECT_MS = 5 * 60_000;

function clearIdleTimer() {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

function scheduleIdleDisconnect() {
  clearIdleTimer();
  if (!nativePort || pending.size) return;
  idleTimer = setTimeout(() => disconnectCodexNative(), IDLE_DISCONNECT_MS);
  // Node-based contract tests should not stay alive only for a browser idle
  // timer; browser timers simply do not expose unref().
  idleTimer?.unref?.();
}

function publicNativeError(message, code = 'CODEX_CONNECTION_FAILED', retryable = true) {
  const error = new Error(String(message || 'The local Codex connection is unavailable.'));
  error.code = code;
  error.retryable = retryable;
  return error;
}

function removePending(requestId, entry) {
  if (pending.get(requestId) !== entry) return false;
  pending.delete(requestId);
  clearTimeout(entry.timer);
  entry.signal?.removeEventListener('abort', entry.onAbort);
  return true;
}

function rejectPendingForPort(port, error) {
  for (const [requestId, entry] of pending) {
    if (entry.port !== port) continue;
    removePending(requestId, entry);
    entry.reject(error);
  }
}

function handleNativeMessage(port, message) {
  const key = String(message?.id);
  const entry = pending.get(key);
  if (!entry || entry.port !== port) return;
  removePending(key, entry);

  if (message?.version !== CODEX_NATIVE_PROTOCOL_VERSION || typeof message?.ok !== 'boolean') {
    const error = publicNativeError(
      'The local Codex connection uses an incompatible protocol. Update the companion.',
      'CODEX_PROTOCOL_MISMATCH',
      false
    );
    entry.reject(error);
    rejectPendingForPort(port, error);
    compatibleHealthPromise = null;
    compatibleHealthPort = null;
    compatibleHealthReady = false;
    if (nativePort === port) nativePort = null;
    try { port.disconnect(); } catch { }
    return;
  }

  if (message.ok) {
    entry.resolve(message.result);
    scheduleIdleDisconnect();
    return;
  }
  const nativeError = message?.error || {};
  entry.reject(publicNativeError(
    nativeError.message,
    nativeError.code || 'CODEX_REQUEST_FAILED',
    nativeError.retryable !== false
  ));
  scheduleIdleDisconnect();
}

function handleNativeDisconnect(port) {
  if (nativePort !== port) return;
  clearIdleTimer();
  // Read lastError inside the callback to keep Chromium from reporting it as
  // unchecked, but never expose native-host implementation details to pages.
  void api?.runtime?.lastError?.message;
  nativePort = null;
  compatibleHealthPromise = null;
  compatibleHealthPort = null;
  compatibleHealthReady = false;
  rejectPendingForPort(port, publicNativeError(
    'The local Codex connection is unavailable. Open settings to enable or repair it.',
    'CODEX_CONNECTION_CLOSED',
    true
  ));
}

function getNativePort() {
  clearIdleTimer();
  if (nativePort) return nativePort;
  if (typeof api?.runtime?.connectNative !== 'function') {
    throw publicNativeError('Codex translation is only available in a supported Chromium browser.', 'CODEX_UNSUPPORTED', false);
  }

  try {
    const port = api.runtime.connectNative(CODEX_NATIVE_HOST);
    nativePort = port;
    port.onMessage.addListener(message => handleNativeMessage(port, message));
    port.onDisconnect.addListener(() => handleNativeDisconnect(port));
    return port;
  } catch (error) {
    nativePort = null;
    throw publicNativeError('The local Codex connection could not start.', 'CODEX_CONNECTION_FAILED', true);
  }
}

function cancelNativeRequest(port, requestId) {
  try {
    port.postMessage({
      version: CODEX_NATIVE_PROTOCOL_VERSION,
      id: `cancel-${requestId}`,
      method: 'cancel',
      params: { requestId }
    });
  } catch { /* The timeout error is already being returned to the caller. */ }
}

export function sendCodexNativeRequest(
  method,
  params = {},
  { timeoutMs = 30_000, signal, requireCompatibleHealth = false } = {}
) {
  try { throwIfAborted(signal); }
  catch (error) { return Promise.reject(error); }
  const safeTimeout = Math.min(185_000, Math.max(1_000, Number(timeoutMs) || 30_000));
  const requestId = `extension-${Date.now()}-${++sequence}`;
  let port;
  try { port = getNativePort(); }
  catch (error) { return Promise.reject(error); }
  if (requireCompatibleHealth && (!compatibleHealthReady || compatibleHealthPort !== port)) {
    return Promise.reject(publicNativeError(
      'The local Codex connection must complete a compatibility check before translation.',
      'CODEX_HEALTH_REQUIRED',
      true
    ));
  }

  return new Promise((resolve, reject) => {
    const entry = { port, resolve, reject, timer: null, signal, onAbort: null };
    const timer = setTimeout(() => {
      if (!removePending(requestId, entry)) return;
      cancelNativeRequest(port, requestId);
      reject(publicNativeError('The local Codex translation timed out.', 'CODEX_TIMEOUT', true));
      scheduleIdleDisconnect();
    }, safeTimeout);
    entry.timer = timer;
    entry.onAbort = () => {
      if (!removePending(requestId, entry)) return;
      cancelNativeRequest(port, requestId);
      reject(createAbortError(signal, 'The local Codex translation was cancelled.'));
      scheduleIdleDisconnect();
    };
    pending.set(requestId, entry);
    signal?.addEventListener('abort', entry.onAbort, { once: true });
    if (signal?.aborted) {
      entry.onAbort();
      return;
    }

    try {
      port.postMessage({
        version: CODEX_NATIVE_PROTOCOL_VERSION,
        id: requestId,
        method,
        params
      });
    } catch (error) {
      removePending(requestId, entry);
      reject(publicNativeError('The translation could not be sent to local Codex.', 'CODEX_SEND_FAILED', true));
      scheduleIdleDisconnect();
    }
  });
}

function waitForPromiseOrAbort(promise, signal) {
  if (!signal) return promise;
  try { throwIfAborted(signal); }
  catch (error) { return Promise.reject(error); }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, createAbortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    promise.then(
      value => finish(resolve, value),
      error => finish(reject, error)
    );
  });
}

export async function getCodexNativeHealth(signal) {
  throwIfAborted(signal);
  const port = getNativePort();
  if (compatibleHealthPromise && compatibleHealthPort !== port) {
    compatibleHealthPromise = null;
    compatibleHealthPort = null;
    compatibleHealthReady = false;
  }
  if (!compatibleHealthPromise) {
    compatibleHealthPort = port;
    compatibleHealthReady = false;
    let cachedPromise;
    cachedPromise = sendCodexNativeRequest('health', {}, { timeoutMs: 8_000 })
      .then(result => {
        if (
          result?.protocolVersion !== CODEX_NATIVE_PROTOCOL_VERSION
          || result?.securityProfile !== CODEX_NATIVE_SECURITY_PROFILE
        ) {
          throw publicNativeError(
            'The local Codex companion is missing required security updates.',
            'CODEX_COMPANION_UPDATE_REQUIRED',
            false
          );
        }
        if (nativePort !== port) {
          throw publicNativeError(
            'The local Codex connection changed during its compatibility check.',
            'CODEX_HEALTH_REQUIRED',
            true
          );
        }
        compatibleHealthReady = true;
        return result;
      })
      .catch(error => {
        if (compatibleHealthPromise === cachedPromise) {
          compatibleHealthPromise = null;
          compatibleHealthPort = null;
          compatibleHealthReady = false;
        }
        throw error;
      });
    compatibleHealthPromise = cachedPromise;
  }
  return waitForPromiseOrAbort(compatibleHealthPromise, signal);
}

export async function requestCodexNativePermission() {
  if (typeof api?.permissions?.request !== 'function' || typeof api?.runtime?.connectNative !== 'function') return false;
  try {
    return await callApi(api.permissions.request.bind(api.permissions), { permissions: ['nativeMessaging'] });
  } catch {
    return false;
  }
}

export function closeCodexNativeSession(sessionId) {
  if (
    typeof sessionId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sessionId)
    || !nativePort
    || !compatibleHealthReady
  ) {
    return Promise.resolve(false);
  }
  return sendCodexNativeRequest('closeSession', { sessionId }, {
    timeoutMs: 10_000,
    requireCompatibleHealth: true
  }).then(result => result?.closed === true, () => false);
}

export function disconnectCodexNative() {
  clearIdleTimer();
  compatibleHealthPromise = null;
  compatibleHealthPort = null;
  compatibleHealthReady = false;
  if (!nativePort) return;
  const port = nativePort;
  nativePort = null;
  rejectPendingForPort(port, publicNativeError('The local Codex connection was reset.', 'CODEX_CONNECTION_RESET', true));
  try { port.disconnect(); } catch { }
}
