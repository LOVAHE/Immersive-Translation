const PUBLIC_ERRORS = Object.freeze({
  AUTH_REQUIRED: {
    message: 'Codex is not signed in.',
    retryable: false
  },
  CANCELLED: {
    message: 'The request was cancelled.',
    retryable: true
  },
  CODEX_FAILED: {
    message: 'Codex could not complete the translation.',
    retryable: true
  },
  DUPLICATE_REQUEST: {
    message: 'A request with this ID is already pending.',
    retryable: false
  },
  HOST_SHUTTING_DOWN: {
    message: 'The local companion is shutting down.',
    retryable: true
  },
  INTERNAL_ERROR: {
    message: 'The local companion encountered an internal error.',
    retryable: true
  },
  INVALID_OUTPUT: {
    message: 'Codex returned an invalid translation result.',
    retryable: true
  },
  INVALID_REQUEST: {
    message: 'The native-messaging request is invalid.',
    retryable: false
  },
  MESSAGE_TOO_LARGE: {
    message: 'The native-messaging request is too large.',
    retryable: false
  },
  MODEL_UNAVAILABLE: {
    message: 'The configured Codex model is unavailable for this account.',
    retryable: false
  },
  RATE_LIMITED: {
    message: 'The Codex usage limit was reached.',
    retryable: true
  },
  SDK_UNAVAILABLE: {
    message: 'The Codex SDK is not installed or cannot start.',
    retryable: false
  },
  TIMEOUT: {
    message: 'The Codex translation timed out.',
    retryable: true
  },
  UNAVAILABLE: {
    message: 'Codex is temporarily unavailable.',
    retryable: true
  }
});

export class CompanionError extends Error {
  constructor(code, options = {}) {
    const definition = PUBLIC_ERRORS[code] ?? PUBLIC_ERRORS.INTERNAL_ERROR;
    super(definition.message, options);
    this.name = 'CompanionError';
    this.code = PUBLIC_ERRORS[code] ? code : 'INTERNAL_ERROR';
    this.retryable = definition.retryable;
  }
}

export function asCompanionError(error) {
  if (error instanceof CompanionError) {
    return error;
  }
  return new CompanionError('INTERNAL_ERROR');
}

export function classifyCodexError(error) {
  if (error instanceof CompanionError) {
    return error;
  }

  // This text is used only for coarse classification. It is never returned to
  // the extension, written to stdout, or retained in service status.
  const detail = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : '';

  if (
    detail.includes('cannot find package') ||
    detail.includes('cannot find module') ||
    detail.includes('unable to locate codex cli') ||
    detail.includes('unsupported platform')
  ) {
    return new CompanionError('SDK_UNAVAILABLE');
  }
  if (
    detail.includes('not logged in') ||
    detail.includes('login required') ||
    detail.includes('authentication') ||
    detail.includes('unauthorized') ||
    /\b401\b/.test(detail)
  ) {
    return new CompanionError('AUTH_REQUIRED');
  }
  if (
    detail.includes('rate limit') ||
    detail.includes('usage limit') ||
    detail.includes('limit reached') ||
    /\b429\b/.test(detail)
  ) {
    return new CompanionError('RATE_LIMITED');
  }
  if (
    detail.includes('model not found') ||
    detail.includes('model is not available') ||
    detail.includes('unsupported model') ||
    detail.includes('unknown model') ||
    (detail.includes('model') && detail.includes('does not have access'))
  ) {
    return new CompanionError('MODEL_UNAVAILABLE');
  }
  if (
    detail.includes('network') ||
    detail.includes('connection') ||
    detail.includes('temporarily unavailable') ||
    detail.includes('econn')
  ) {
    return new CompanionError('UNAVAILABLE');
  }
  return new CompanionError('CODEX_FAILED');
}

export function errorPayload(error) {
  const safe = asCompanionError(error);
  return {
    code: safe.code,
    message: safe.message,
    retryable: safe.retryable
  };
}
