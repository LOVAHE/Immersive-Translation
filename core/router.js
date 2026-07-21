import { getSettings } from './settings.js';
import { getProvider } from '../providers/index.js';
import { providerSupports, resolveProviderId } from '../providers/catalog.js';
import { shouldUseDictionary } from './providerRouting.js';
import { classifyText } from './textKind.js';
import { createLogger } from './log.js';
import { api } from './browser.js';
import { createAbortError, throwIfAborted } from './utils.js';
import { normalizeTranslationRequestId } from './translationRequests.js';

const L = createLogger('router');
const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';

export function createPublicTranslationResult(providerResult, metadata) {
  const result = providerResult && typeof providerResult === 'object'
    ? providerResult
    : {};
  const { raw: _providerRaw, ...publicFields } = result;
  return { ...publicFields, ...metadata };
}

let offscreenRequestSequence = 0;

async function handleChromeAiRequest(action, payload, signal) {
  throwIfAborted(signal);
  if (!api.offscreen?.createDocument || !api.runtime?.getContexts) {
    throw new Error('Chrome AI local provider is only available in Chrome.');
  }

  // Find the offscreen document.
  const existingContexts = await api.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [api.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (!existingContexts.length) {
    L.info('Creating offscreen document');
    await api.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['USER_ACTION'],
      justification: 'The Chrome AI API (Gemini Nano) is only available in a document context.',
    });
  }
  throwIfAborted(signal);

  L.info('Sending request to offscreen document', { action });
  const requestId = `offscreen-${Date.now()}-${++offscreenRequestSequence}`;
  let response;
  if (!signal) {
    response = await api.runtime.sendMessage({
      target: 'offscreen',
      action: action,
      details: payload,
      requestId
    });
  } else {
    response = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        callback(value);
      };
      const onAbort = () => {
        void Promise.resolve(api.runtime.sendMessage({
          target: 'offscreen',
          action: 'cancel',
          requestId
        })).catch(() => {});
        finish(reject, createAbortError(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
      // The abort listener is already installed. JavaScript cannot deliver a
      // separate abort task during this synchronous dispatch, so the cancel
      // message cannot overtake its correlated offscreen request.
      const pending = Promise.resolve(api.runtime.sendMessage({
        target: 'offscreen',
        action: action,
        details: payload,
        requestId
      }));
      pending.then(
        value => finish(resolve, value),
        error => finish(reject, error)
      );
    });
  }

  if (!response.ok) {
    throw new Error(response.error || 'Offscreen document failed to handle the request.');
  }
  return response.result;
}

const PERSISTENT_TRANSLATION_INTENTS = new Set(['page', 'pdf', 'youtube']);

function translationContext(intent, contextId) {
  const context = { intent };
  if (contextId == null || !PERSISTENT_TRANSLATION_INTENTS.has(intent)) return context;
  context.contextId = normalizeTranslationRequestId(contextId);
  return context;
}

export async function handleTranslate({ text, sourceLang, targetLang, intent, contextId, signal }) {
  throwIfAborted(signal);
  if (!text || !text.trim()) throw new Error('No text to translate');
  const s = await getSettings();
  throwIfAborted(signal);
  const providerId = resolveProviderId(s.provider);
  
  const tgt = targetLang || s.targetLang || 'zh';
  const src = sourceLang || s.sourceLang || 'auto';
  const { probablyWord } = classifyText(text);
  
  const useDict = shouldUseDictionary({
    providerId,
    probablyWord,
    enabled: s.enableWordDictionary
  });
  const payload = {
    text,
    sourceLang: src,
    targetLang: tgt,
    context: translationContext(intent, contextId),
    signal
  };

  let out;
  if (providerId === 'chrome-ai') {
    const action = useDict ? 'define' : 'translate';
    const { signal: _signal, ...cloneablePayload } = payload;
    out = await handleChromeAiRequest(action, cloneablePayload, signal);
  } else {
    const provider = getProvider(providerId, s);
    out = useDict ? await provider.define(payload) : await provider.translate(payload);
  }
  // A provider may finish at the same time cancellation arrives, or a local
  // implementation may not honor AbortSignal. Never publish that stale result.
  throwIfAborted(signal);
  
  return createPublicTranslationResult(out, {
    mode: useDict ? 'dictionary' : 'translate',
    provider: providerId,
    sourceLang: src,
    targetLang: tgt,
    text
  });
}

export async function handleVisionTranslate({ imageDataUrl, targetLang }) {
  if (!imageDataUrl) throw new Error('No image data to translate');
  const s = await getSettings();
  const providerId = resolveProviderId(s.provider);
  const tgt = targetLang || s.targetLang || 'zh';
  const payload = { imageDataUrl, targetLang: tgt };

  if (!providerSupports(providerId, 'vision')) {
    throw new Error(`Provider ${providerId} does not support vision translation.`);
  }

  let out;
  if (providerId === 'chrome-ai') {
    out = await handleChromeAiRequest('visionTranslate', payload);
  } else {
    const provider = getProvider(providerId, s);
    out = await provider.visionTranslate(payload);
  }

  return createPublicTranslationResult(out, {
    mode: 'translate',
    provider: providerId,
    targetLang: tgt
  });
}
