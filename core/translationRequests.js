const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function normalizeTranslationRequestId(value, { optional = false } = {}) {
  if (value == null && optional) return null;
  const requestId = typeof value === 'string' ? value.trim() : '';
  if (!REQUEST_ID_PATTERN.test(requestId)) {
    const error = new Error('Invalid translation request ID.');
    error.code = 'INVALID_TRANSLATION_REQUEST_ID';
    throw error;
  }
  return requestId;
}

export function translationRequestOwner(sender = {}) {
  const extensionId = String(sender?.id || 'extension');
  const tabId = sender?.tab?.id;
  if (Number.isInteger(tabId)) {
    const documentId = String(sender?.documentId || 'document');
    return `${extensionId}:tab:${tabId}:frame:${Number(sender?.frameId) || 0}:document:${documentId}`;
  }
  return `${extensionId}:page:${String(sender?.url || '')}`;
}

export class TranslationRequestRegistry {
  constructor() {
    this.requests = new Map();
  }

  start(requestIdValue, owner) {
    const requestId = normalizeTranslationRequestId(requestIdValue, { optional: true });
    const controller = new AbortController();
    const ticket = { requestId, owner: String(owner || ''), controller };

    // Missing IDs are the legacy protocol. They remain functional, but cannot
    // be cancelled by a later message because there is no stable correlation.
    if (!requestId) return ticket;
    if (this.requests.has(requestId)) {
      const error = new Error('Translation request ID is already active.');
      error.code = 'DUPLICATE_TRANSLATION_REQUEST_ID';
      throw error;
    }
    this.requests.set(requestId, ticket);
    return ticket;
  }

  finish(ticket) {
    if (!ticket?.requestId) return;
    if (this.requests.get(ticket.requestId) === ticket) {
      this.requests.delete(ticket.requestId);
    }
  }

  cancel(requestIdValue, owner, reason = 'Translation cancelled.') {
    let requestId;
    try {
      requestId = normalizeTranslationRequestId(requestIdValue);
    } catch {
      return false;
    }
    const ticket = this.requests.get(requestId);
    if (!ticket || ticket.owner !== String(owner || '')) return false;
    this.requests.delete(requestId);
    const error = new Error(reason);
    error.name = 'AbortError';
    error.code = 'TRANSLATION_CANCELLED';
    ticket.controller.abort(error);
    return true;
  }
}
