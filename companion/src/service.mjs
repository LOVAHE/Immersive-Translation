import { PROTOCOL_VERSION, SECURITY_PROFILE, SERVICE_VERSION } from './constants.mjs';
import { CompanionError, asCompanionError, errorPayload } from './errors.mjs';
import { SerialTaskQueue } from './queue.mjs';
import {
  canonicalRequestId,
  parseRequest,
  responseIdFromUnknown
} from './validation.mjs';

function success(id, result) {
  return {
    version: PROTOCOL_VERSION,
    id,
    ok: true,
    result
  };
}

function failure(id, error) {
  return {
    version: PROTOCOL_VERSION,
    id,
    ok: false,
    error: errorPayload(error)
  };
}

export class CompanionService {
  #accountState = 'unknown';
  #lastErrorCode = null;
  #lastTranslationAt = null;
  #now;
  #queue;
  #translator;

  constructor(translator, { queue = new SerialTaskQueue(), now = () => new Date() } = {}) {
    this.#translator = translator;
    this.#queue = queue;
    this.#now = now;
  }

  async handle(value) {
    const fallbackId = responseIdFromUnknown(value);
    let request;
    try {
      request = parseRequest(value);
    } catch (error) {
      return failure(fallbackId, asCompanionError(error));
    }

    try {
      switch (request.method) {
        case 'health':
          return success(request.id, await this.#health());
        case 'account':
          return success(request.id, this.#account());
        case 'status':
          return success(request.id, this.#status());
        case 'cancel':
          return success(request.id, this.#cancel(request.params.requestId));
        case 'closeSession':
          return success(request.id, await this.#closeSession(request));
        case 'translateBatch':
          return success(request.id, await this.#translate(request));
        default:
          throw new CompanionError('INVALID_REQUEST');
      }
    } catch (error) {
      const safe = asCompanionError(error);
      this.#lastErrorCode = safe.code;
      if (safe.code === 'AUTH_REQUIRED') {
        this.#accountState = 'signed_out';
      }
      return failure(request.id, safe);
    }
  }

  shutdown() {
    this.#queue.shutdown();
    void this.#translator.shutdown?.();
  }

  async #health() {
    const dependency = await this.#translator.health();
    return {
      service: dependency.sdkAvailable ? 'ready' : 'degraded',
      serviceVersion: SERVICE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      securityProfile: SECURITY_PROFILE,
      sdkAvailable: dependency.sdkAvailable,
      ...(dependency.errorCode ? { errorCode: dependency.errorCode } : {})
    };
  }

  #account() {
    return {
      state: this.#accountState,
      source:
        this.#accountState === 'unknown'
          ? 'sdk_does_not_expose_account'
          : 'last_translation_attempt',
      plan: null,
      identity: null
    };
  }

  #status() {
    return {
      ...this.#queue.snapshot(),
      lastTranslationAt: this.#lastTranslationAt,
      lastErrorCode: this.#lastErrorCode
    };
  }

  #cancel(requestId) {
    const state = this.#queue.cancel(canonicalRequestId(requestId));
    return {
      requestId,
      cancelled: state !== 'not_found',
      state
    };
  }

  async #translate(request) {
    const translations = await this.#queue.enqueue(
      canonicalRequestId(request.id),
      request.params.timeoutMs,
      (signal) => this.#translator.translate(request.params, { signal })
    );
    this.#accountState = 'signed_in';
    this.#lastErrorCode = null;
    this.#lastTranslationAt = this.#now().toISOString();
    return { translations };
  }

  async #closeSession(request) {
    const closed = await this.#queue.enqueue(
      canonicalRequestId(request.id),
      10_000,
      () => this.#translator.closeSession?.(request.params.sessionId) ?? false
    );
    return { sessionId: request.params.sessionId, closed: closed === true };
  }
}

export function internalFailureResponse() {
  return failure(null, new CompanionError('INTERNAL_ERROR'));
}
