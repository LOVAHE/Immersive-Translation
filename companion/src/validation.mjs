import {
  DEFAULT_TIMEOUT_MS,
  MAX_BATCH_CHARS,
  MAX_BATCH_ITEMS,
  MAX_ITEM_CHARS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  PROTOCOL_VERSION
} from './constants.mjs';
import { CompanionError } from './errors.mjs';

const REQUEST_METHODS = new Set(['health', 'account', 'status', 'translateBatch', 'closeSession', 'cancel']);
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_SESSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function invalid() {
  throw new CompanionError('INVALID_REQUEST');
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(value, allowed, required = allowed) {
  if (!isRecord(value)) {
    invalid();
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))) {
    invalid();
  }
  if (required.some((key) => !Object.hasOwn(value, key))) {
    invalid();
  }
}

export function isValidRequestId(value) {
  return (
    (typeof value === 'string' && SAFE_ID.test(value)) ||
    (Number.isSafeInteger(value) && value >= 0)
  );
}

export function canonicalRequestId(value) {
  return `${typeof value}:${String(value)}`;
}

function parseId(value) {
  if (!isValidRequestId(value)) {
    invalid();
  }
  return value;
}

function parseEmptyParams(params) {
  if (params === undefined) {
    return {};
  }
  assertExactKeys(params, [], []);
  return {};
}

function parseLanguage(value) {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 64 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    invalid();
  }
  return value;
}

function parseModel(value) {
  if (value === undefined) return null;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 128 ||
    value !== value.trim() ||
    !SAFE_MODEL.test(value)
  ) {
    invalid();
  }
  return value;
}

function parseSessionId(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !SAFE_SESSION.test(value)) invalid();
  return value;
}

function parseTranslateParams(params) {
  assertExactKeys(
    params,
    ['sourceLang', 'targetLang', 'items', 'instructions', 'model', 'sessionId', 'timeoutMs'],
    ['sourceLang', 'targetLang', 'items']
  );

  if (!Array.isArray(params.items) || params.items.length < 1 || params.items.length > MAX_BATCH_ITEMS) {
    invalid();
  }

  const seenIds = new Set();
  let totalChars = 0;
  const items = params.items.map((item) => {
    assertExactKeys(item, ['id', 'text']);
    const id = parseId(item.id);
    const key = canonicalRequestId(id);
    if (seenIds.has(key) || typeof item.text !== 'string' || item.text.length > MAX_ITEM_CHARS) {
      invalid();
    }
    seenIds.add(key);
    totalChars += item.text.length;
    if (totalChars > MAX_BATCH_CHARS) {
      invalid();
    }
    return { id, text: item.text };
  });

  const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_TIMEOUT_MS ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    invalid();
  }

  return {
    sourceLang: parseLanguage(params.sourceLang),
    targetLang: parseLanguage(params.targetLang),
    items,
    instructions: parseInstructions(params.instructions),
    model: parseModel(params.model),
    sessionId: parseSessionId(params.sessionId),
    timeoutMs
  };
}

function parseInstructions(value) {
  if (value === undefined) {
    return null;
  }
  assertExactKeys(value, ['system', 'user'], []);
  if (!Object.hasOwn(value, 'system') && !Object.hasOwn(value, 'user')) {
    invalid();
  }
  const result = {};
  let totalChars = 0;
  for (const key of ['system', 'user']) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    if (typeof value[key] !== 'string' || value[key].length > 8_000) {
      invalid();
    }
    totalChars += value[key].length;
    result[key] = value[key];
  }
  if (totalChars > 12_000) {
    invalid();
  }
  return result;
}

function parseCancelParams(params) {
  assertExactKeys(params, ['requestId']);
  return { requestId: parseId(params.requestId) };
}

function parseCloseSessionParams(params) {
  assertExactKeys(params, ['sessionId']);
  if (params.sessionId === undefined) invalid();
  return { sessionId: parseSessionId(params.sessionId) };
}

export function parseRequest(value) {
  assertExactKeys(value, ['version', 'id', 'method', 'params'], ['version', 'id', 'method']);
  if (value.version !== PROTOCOL_VERSION) {
    invalid();
  }
  const id = parseId(value.id);
  if (typeof value.method !== 'string' || !REQUEST_METHODS.has(value.method)) {
    invalid();
  }

  if (value.method === 'translateBatch') {
    return { id, method: value.method, params: parseTranslateParams(value.params) };
  }
  if (value.method === 'cancel') {
    const params = parseCancelParams(value.params);
    if (canonicalRequestId(id) === canonicalRequestId(params.requestId)) {
      invalid();
    }
    return { id, method: value.method, params };
  }
  if (value.method === 'closeSession') {
    return { id, method: value.method, params: parseCloseSessionParams(value.params) };
  }
  return { id, method: value.method, params: parseEmptyParams(value.params) };
}

export function responseIdFromUnknown(value) {
  if (isRecord(value) && isValidRequestId(value.id)) {
    return value.id;
  }
  return null;
}
