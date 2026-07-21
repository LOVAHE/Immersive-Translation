import { BaseTranslator } from './base.js';
import { BATCH_SEPARATOR } from '../core/batchTranslation.js';
import {
  closeCodexNativeSession,
  getCodexNativeHealth,
  sendCodexNativeRequest
} from '../core/codexNative.js';
import { throwIfAborted } from '../core/utils.js';

// These are protocol-v2 request limits, not model context limits. A contract
// test keeps them aligned with the separately packaged native companion.
export const CODEX_NATIVE_BATCH_LIMITS = Object.freeze({
  maxItems: 128,
  maxItemChars: 8_000,
  maxBatchChars: 64_000
});

const MAX_INSTRUCTION_CHARS = 8_000;
const MAX_INSTRUCTIONS_CHARS = 12_000;
const MAX_MODEL_CHARS = 128;
const MIN_PREFERRED_CHUNK_CHARS = 7_000;
const SENTENCE_END = /[.!?。！？；;]/;
const GRAPHEME_LOOKAHEAD_CHARS = 256;
const graphemeSegmenter = typeof Intl?.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;
let transientSessionSequence = 0;

function codexProviderError(message, code, retryable) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}

function optionalInstructions(config) {
  const instructions = {};
  const system = String(config.promptTranslateSystem || '').trim();
  const user = String(config.promptTranslateUser || '').trim();
  if (system) instructions.system = system;
  if (user) instructions.user = user;
  if (!Object.keys(instructions).length) return undefined;

  const totalChars = Object.values(instructions).reduce((total, value) => total + value.length, 0);
  if (
    Object.values(instructions).some(value => value.length > MAX_INSTRUCTION_CHARS)
    || totalChars > MAX_INSTRUCTIONS_CHARS
  ) {
    throw codexProviderError(
      'Codex translation instructions are too long. Shorten them in extension settings.',
      'CODEX_INSTRUCTIONS_TOO_LONG',
      false
    );
  }
  return instructions;
}

function assertLanguage(value) {
  if (
    typeof value !== 'string'
    || value.length < 1
    || value.length > 64
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw codexProviderError(
      'Codex received an unsupported translation language value.',
      'CODEX_INVALID_LANGUAGE',
      false
    );
  }
}

function optionalModel(config) {
  if (config.model == null || config.model === '') return undefined;
  if (
    typeof config.model !== 'string'
    || config.model !== config.model.trim()
    || config.model.length > MAX_MODEL_CHARS
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(config.model)
  ) {
    throw codexProviderError(
      'The configured Codex model name is invalid.',
      'CODEX_INVALID_MODEL',
      false
    );
  }
  return config.model;
}

function optionalSessionId(context) {
  const sessionId = context?.contextId;
  if (sessionId == null) return undefined;
  if (!['page', 'pdf', 'youtube'].includes(context?.intent)) return undefined;
  if (
    typeof sessionId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(sessionId)
  ) {
    throw codexProviderError(
      'Codex received an invalid translation context.',
      'CODEX_INVALID_CONTEXT',
      false
    );
  }
  return sessionId;
}

function createTransientSessionId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${++transientSessionSequence}`;
  return `short-context-${suffix}`;
}

function fallbackSafeEnd(text, start, candidate) {
  let end = candidate;
  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end -= 1;
  if (text[end - 1] === '\r' && text[end] === '\n') end -= 1;

  // Older engines without Intl.Segmenter still avoid the most common broken
  // cluster boundaries: combining marks, variation selectors, emoji skin-tone
  // modifiers, and the joiner inside an emoji sequence.
  const nextCodePoint = text.codePointAt(end);
  const nextCharacter = nextCodePoint === undefined ? '' : String.fromCodePoint(nextCodePoint);
  const extendsPrevious = /\p{Mark}/u.test(nextCharacter)
    || (nextCodePoint >= 0xFE00 && nextCodePoint <= 0xFE0F)
    || (nextCodePoint >= 0xE0100 && nextCodePoint <= 0xE01EF)
    || (nextCodePoint >= 0x1F3FB && nextCodePoint <= 0x1F3FF)
    || nextCodePoint === 0x200D;
  if (extendsPrevious || text.codePointAt(end - 1) === 0x200D) {
    while (end > start) {
      end -= text.codePointAt(end - 2) > 0xFFFF ? 2 : 1;
      const character = String.fromCodePoint(text.codePointAt(end));
      if (!/\p{Mark}/u.test(character) && character !== '\u200D') break;
    }
  }

  const isRegionalIndicator = codePoint => codePoint >= 0x1F1E6 && codePoint <= 0x1F1FF;
  if (isRegionalIndicator(text.codePointAt(end)) && end > start) {
    let cursor = end;
    let precedingIndicators = 0;
    let lastIndicatorWidth = 0;
    while (cursor > start) {
      const low = text.charCodeAt(cursor - 1);
      const width = low >= 0xDC00 && low <= 0xDFFF
        && cursor >= start + 2
        && text.charCodeAt(cursor - 2) >= 0xD800
        && text.charCodeAt(cursor - 2) <= 0xDBFF
        ? 2
        : 1;
      const codePoint = text.codePointAt(cursor - width);
      if (!isRegionalIndicator(codePoint)) break;
      if (precedingIndicators === 0) lastIndicatorWidth = width;
      precedingIndicators += 1;
      cursor -= width;
    }
    // UAX #29 groups regional indicators in pairs from the start of their
    // contiguous run, so a boundary after an odd count would split a flag.
    if (precedingIndicators % 2 === 1) end -= lastIndicatorWidth;
  }
  return end;
}

function graphemeSafeEnd(text, start, candidate) {
  if (candidate >= text.length) return candidate;
  if (!graphemeSegmenter) return fallbackSafeEnd(text, start, candidate);

  const viewEnd = Math.min(text.length, candidate + GRAPHEME_LOOKAHEAD_CHARS);
  let previousBoundary = start;
  for (const segment of graphemeSegmenter.segment(text.slice(start, viewEnd))) {
    const boundary = start + segment.index;
    if (boundary === candidate) return candidate;
    if (boundary > candidate) return previousBoundary;
    previousBoundary = boundary;
  }
  // If the final grapheme continues beyond our bounded lookahead, its start is
  // still the last safe boundary reported by Segmenter.
  return previousBoundary;
}

function safeChunkEnd(text, start) {
  const hardEnd = Math.min(start + CODEX_NATIVE_BATCH_LIMITS.maxItemChars, text.length);
  if (hardEnd >= text.length) return hardEnd;
  const preferredStart = Math.min(hardEnd, start + MIN_PREFERRED_CHUNK_CHARS);

  for (let index = hardEnd - 1; index >= preferredStart; index -= 1) {
    const character = text[index];
    if (character === '\r' && text[index + 1] === '\n') continue;
    if (character === '\n' || SENTENCE_END.test(character) || /\s/.test(character)) {
      const boundary = graphemeSafeEnd(text, start, index + 1);
      if (boundary >= preferredStart) return boundary;
    }
  }

  // Native validation counts UTF-16 code units. Respect the same hard limit
  // without cutting a user-perceived character (combining marks, emoji ZWJ
  // sequences, flags, variation selectors, or surrogate pairs).
  return graphemeSafeEnd(text, start, hardEnd);
}

function splitNativeItem(text) {
  if (text.length <= CODEX_NATIVE_BATCH_LIMITS.maxItemChars) return [text];
  const chunks = [];
  for (let start = 0; start < text.length;) {
    const end = safeChunkEnd(text, start);
    if (end <= start) {
      throw codexProviderError(
        'Codex could not safely split this translation item.',
        'CODEX_BATCH_PREPARATION_FAILED',
        false
      );
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function createTranslationPlan(sourceItems) {
  const groups = sourceItems.map((sourceText, sourceIndex) => {
    const chunks = splitNativeItem(sourceText);
    const fragmented = chunks.length > 1;
    return chunks.map((chunk, partIndex) => ({
      id: chunk.trim()
        ? (fragmented ? `segment-${sourceIndex}-part-${partIndex}` : `segment-${sourceIndex}`)
        : null,
      text: chunk
    }));
  });
  return {
    groups,
    items: groups.flat().filter(item => item.id !== null)
  };
}

function createNativeBatches(items) {
  const batches = [];
  let batch = [];
  let batchChars = 0;

  for (const item of items) {
    if (item.text.length > CODEX_NATIVE_BATCH_LIMITS.maxItemChars) {
      throw codexProviderError(
        'Codex could not prepare a translation item within the companion limit.',
        'CODEX_BATCH_PREPARATION_FAILED',
        false
      );
    }
    if (
      batch.length > 0
      && (
        batch.length >= CODEX_NATIVE_BATCH_LIMITS.maxItems
        || batchChars + item.text.length > CODEX_NATIVE_BATCH_LIMITS.maxBatchChars
      )
    ) {
      batches.push(batch);
      batch = [];
      batchChars = 0;
    }
    batch.push({ id: item.id, text: item.text });
    batchChars += item.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function invalidNativeBatch() {
  return codexProviderError(
    'Codex did not return one complete translation batch. No partial translation was used.',
    'CODEX_INVALID_BATCH',
    true
  );
}

function readNativeTranslations(result, items) {
  const translations = result?.translations;
  if (!Array.isArray(translations) || translations.length !== items.length) {
    throw invalidNativeBatch();
  }

  const expected = new Map(items.map(item => [item.id, item]));
  const byId = new Map();
  for (const translation of translations) {
    if (
      typeof translation?.id !== 'string'
      || typeof translation?.text !== 'string'
      || !expected.has(translation.id)
      || byId.has(translation.id)
      || !translation.text.trim()
    ) {
      throw invalidNativeBatch();
    }
    byId.set(translation.id, translation.text);
  }
  if (byId.size !== expected.size) throw invalidNativeBatch();
  return byId;
}

function rebuildSourceItems(groups, translatedById) {
  return groups.map(parts => parts.map(part => {
    if (part.id === null) return part.text;
    if (!translatedById.has(part.id)) throw invalidNativeBatch();
    return translatedById.get(part.id);
  }).join(''));
}

export class CodexTranslate extends BaseTranslator {
  id = 'codex';
  label = 'Codex (Experimental)';

  async translate({ text, sourceLang = 'auto', targetLang, context, signal }) {
    throwIfAborted(signal);
    assertLanguage(sourceLang);
    assertLanguage(targetLang);
    const instructions = optionalInstructions(this.config);
    const model = optionalModel(this.config);
    const persistentSessionId = optionalSessionId(context);
    const sourceItems = String(text ?? '').split(BATCH_SEPARATOR);
    const plan = createTranslationPlan(sourceItems);
    const batches = createNativeBatches(plan.items);

    await getCodexNativeHealth(signal);
    const transientSessionId = !persistentSessionId && batches.length > 1
      ? createTransientSessionId()
      : null;
    const sessionId = persistentSessionId || transientSessionId;
    try {
      const translatedById = new Map();
      for (const items of batches) {
        throwIfAborted(signal);
        let result;
        try {
          result = await sendCodexNativeRequest('translateBatch', {
            sourceLang,
            targetLang,
            items,
            instructions,
            ...(model ? { model } : {}),
            ...(sessionId ? { sessionId } : {}),
            timeoutMs: 180_000
          }, {
            timeoutMs: 185_000,
            signal,
            requireCompatibleHealth: true
          });
        } catch (error) {
          if (error?.code !== 'INVALID_REQUEST' && error?.code !== 'MESSAGE_TOO_LARGE') throw error;
          throw codexProviderError(
            'The local Codex companion rejected a safely bounded translation batch. Update the extension and companion.',
            'CODEX_BATCH_REJECTED',
            false
          );
        }
        for (const [id, translated] of readNativeTranslations(result, items)) {
          if (translatedById.has(id)) throw invalidNativeBatch();
          translatedById.set(id, translated);
        }
      }

      if (translatedById.size !== plan.items.length) throw invalidNativeBatch();
      const ordered = rebuildSourceItems(plan.groups, translatedById);

      return {
        translated: ordered.join(BATCH_SEPARATOR),
        mode: 'translate',
        provider: this.id
      };
    } finally {
      if (transientSessionId) await closeCodexNativeSession(transientSessionId);
    }
  }
}
