import { api, callApi } from './browser.js';

export const PDF_REQUEST_PREFIX = 'pdfRequest:';
export const PDF_REQUEST_MAX_AGE_MS = 10 * 60 * 1000;

function requestKey(requestId) {
  const id = String(requestId || '').trim();
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(id)) throw new Error('Invalid PDF request.');
  return `${PDF_REQUEST_PREFIX}${id}`;
}

async function writeArea(area, key, value) {
  await callApi(area.set.bind(area), { [key]: value });
}

export function expiredPdfRequestKeys(entries = {}, now = Date.now()) {
  return Object.entries(entries)
    .filter(([key, value]) => {
      if (!key.startsWith(PDF_REQUEST_PREFIX)) return false;
      const age = now - Number(value?.createdAt || 0);
      return !value?.src || age < 0 || age > PDF_REQUEST_MAX_AGE_MS;
    })
    .map(([key]) => key);
}

export async function cleanupExpiredPdfRequests(now = Date.now()) {
  const stored = await callApi(api.storage.local.get.bind(api.storage.local), null);
  for (const key of expiredPdfRequestKeys(stored, now)) {
    await callApi(api.storage.local.remove.bind(api.storage.local), key);
  }
}

export async function removePdfRequest(requestId) {
  const key = requestKey(requestId);
  const areas = [api.storage.session, api.storage.local].filter(Boolean);
  const results = await Promise.allSettled(
    areas.map(area => callApi(area.remove.bind(area), key))
  );
  if (results.length && results.every(result => result.status === 'rejected')) {
    throw results[0].reason;
  }
}

export async function savePdfRequest({ requestId, src }) {
  const key = requestKey(requestId);
  const value = { src: String(src || ''), createdAt: Date.now() };
  if (!value.src) throw new Error('A PDF URL is required.');

  // Local storage is only a compatibility fallback, so prune abandoned
  // one-time requests whenever a new handoff is created.
  await cleanupExpiredPdfRequests().catch(() => {});

  if (api.storage.session) {
    try {
      await writeArea(api.storage.session, key, value);
      return key;
    } catch { /* Firefox versions without writable session storage use local. */ }
  }
  await writeArea(api.storage.local, key, value);
  return key;
}

async function takeFromArea(area, key) {
  if (!area) return null;
  const stored = await callApi(area.get.bind(area), key);
  await callApi(area.remove.bind(area), key);
  return stored?.[key] || null;
}

export async function consumePdfRequest(requestId) {
  const key = requestKey(requestId);
  let request = null;
  if (api.storage.session) {
    try { request = await takeFromArea(api.storage.session, key); }
    catch { /* Continue with the local fallback. */ }
  }
  if (!request) request = await takeFromArea(api.storage.local, key);
  await cleanupExpiredPdfRequests().catch(() => {});

  const age = Date.now() - Number(request?.createdAt || 0);
  if (!request?.src || age < 0 || age > PDF_REQUEST_MAX_AGE_MS) {
    throw new Error('This PDF request has expired. Open it from the context menu again.');
  }
  return request;
}
