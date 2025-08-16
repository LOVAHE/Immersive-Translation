import { getSettings } from './settings.js';
import { getProvider } from '../providers/index.js';
import { classifyText } from './textKind.js';
import { createLogger } from './log.js';

const L = createLogger('router');
const OFFSCREEN_DOCUMENT_PATH = '/offscreen/offscreen.html';

async function handleChromeAiRequest(action, payload) {
  // Find the offscreen document.
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (!existingContexts.length) {
    L.info('Creating offscreen document');
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['USER_ACTION'],
      justification: 'The Chrome AI API (Gemini Nano) is only available in a document context.',
    });
  }

  L.info('Sending request to offscreen document', { action });
  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    action: action,
    details: payload
  });

  if (!response.ok) {
    throw new Error(response.error || 'Offscreen document failed to handle the request.');
  }
  return response.result;
}

export async function handleTranslate({ text, sourceLang, targetLang, intent }) {
  if (!text || !text.trim()) throw new Error('No text to translate');
  const s = await getSettings();
  const providerId = s.provider || 'openai';
  
  const tgt = targetLang || s.targetLang || 'zh';
  const src = sourceLang || s.sourceLang || 'auto';
  const { probablyWord } = classifyText(text);
  
  // Need to check for `define` function availability on the provider prototype
  // without instantiating it, which is tricky. For now, assume chrome-ai supports it.
  const providerSupportsDict = providerId !== 'google' && providerId !== 'azure' && providerId !== 'deepl';
  const useDict = probablyWord && s.enableWordDictionary && providerSupportsDict;
  const payload = { text, sourceLang: src, targetLang: tgt, context: { intent } };

  let out;
  if (providerId === 'chrome-ai') {
    const action = useDict ? 'define' : 'translate';
    out = await handleChromeAiRequest(action, payload);
  } else {
    const provider = getProvider(providerId, s);
    out = useDict ? await provider.define(payload) : await provider.translate(payload);
  }
  
  return { mode: useDict ? 'dictionary' : 'translate', ...out, provider: providerId, sourceLang: src, targetLang: tgt, text };
}

export async function handleVisionTranslate({ imageDataUrl, targetLang }) {
  if (!imageDataUrl) throw new Error('No image data to translate');
  const s = await getSettings();
  const providerId = s.provider || 'openai';
  const tgt = targetLang || s.targetLang || 'zh';
  const payload = { imageDataUrl, targetLang: tgt };

  let out;
  if (providerId === 'chrome-ai') {
    out = await handleChromeAiRequest('visionTranslate', payload);
  } else {
    const provider = getProvider(providerId, s);
    if (typeof provider.visionTranslate !== 'function') {
      throw new Error(`Provider ${providerId} does not support vision translation.`);
    }
    out = await provider.visionTranslate(payload);
  }

  return { mode: 'translate', ...out, provider: providerId, targetLang: tgt };
}
