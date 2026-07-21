export const HOST_NAME = 'com.adaptive_translation.codex';
export const PROTOCOL_VERSION = 2;
export const SERVICE_VERSION = '3.2.0';
export const SECURITY_PROFILE = 'isolated-chatgpt-v2';

// Chrome accepts up to 64 MiB from an extension, but this bridge deliberately
// keeps its own boundary much smaller. Native-host responses must stay below
// Chrome's 1 MiB limit.
export const MAX_NATIVE_INPUT_BYTES = 2 * 1024 * 1024;
export const MAX_NATIVE_OUTPUT_BYTES = 1024 * 1024;

export const MAX_BATCH_ITEMS = 128;
export const MAX_ITEM_CHARS = 8_000;
export const MAX_BATCH_CHARS = 64_000;
export const MAX_TRANSLATION_CHARS = 512_000;
export const MAX_TRANSLATION_OUTPUT_BYTES = 900 * 1024;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MIN_TIMEOUT_MS = 1_000;
export const MAX_TIMEOUT_MS = 180_000;
