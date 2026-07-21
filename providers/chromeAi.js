// providers/chromeAi.js
import { BaseTranslator } from './base.js';
import { normalizeDictionary } from './dictionary.js';
import { throwIfAborted, withTimeout } from '../core/utils.js';
import { createLogger } from '../core/log.js';
import { buildTranslatePrompt, buildDictionaryPrompt } from '../prompts/common.js';

const L = createLogger('prov-chrome-ai');

function getChromeAiLanguageModel() {
  const model = globalThis.ai?.LanguageModel;
  if (!model) throw new Error('Chrome AI LanguageModel API is not available in this extension context.');
  return model;
}

async function withLanguageModelSession(options, signal, task) {
  throwIfAborted(signal);
  const session = await getChromeAiLanguageModel().create({ ...options, signal });
  const onAbort = () => {
    try { session.destroy?.(); } catch { }
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    throwIfAborted(signal);
    return await task(session);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try { session.destroy?.(); } catch { }
  }
}

export class ChromeAiTranslate extends BaseTranslator {
  id = 'chrome-ai';
  label = 'Chrome AI (Experimental)';
  
  constructor(cfg) {
    super(cfg || {});
    this.timeouts = { translate: 30000, dict: 30000, vision: 30000 };
  }

  static async getAvailability() {
    try {
      const model = globalThis.ai?.LanguageModel;
      if (typeof model?.availability !== 'function') {
        return 'unavailable';
      }
      return await model.availability();
    } catch (e) {
      L.error('getAvailability error', e);
      return 'unavailable';
    }
  }

  async translate({ text, sourceLang = 'auto', targetLang, signal }) {
    const { systemText, userText } = buildTranslatePrompt({
      text, sourceLang, targetLang,
      systemOverride: this.config.promptTranslateSystem,
      userOverride: this.config.promptTranslateUser
    });

    L.info('POST chrome-ai translate');
    const result = await withLanguageModelSession({
      initialPrompts: [{ role: 'system', content: systemText }]
    }, signal, session => withTimeout(
      session.prompt(userText, { signal }),
      this.timeouts.translate
    ));

    // The Gemini provider has a `extractThink` helper. We don't have that concept here,
    // so we just return the text directly.
    const translated = result.trim();

    L.info('translate ok', { outLen: translated.length });
    return { translated, raw: result, think: '', mode: 'translate', provider: this.id };
  }

  async define({ text, targetLang, sourceLang = 'auto', signal }) {
    const { systemText, userText } = buildDictionaryPrompt({
      text, targetLang, sourceLang,
      systemOverride: this.config.promptDictSystem,
      userOverride: this.config.promptDictUser
    });

    // This schema should match the structure expected by the rest of the extension.
    const schema = {
      type: 'object',
      properties: {
        headword: { type: 'string' },
        phonetic: { type: ['string', 'null'] },
        senses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pos: { type: 'string' },
              gloss_tl: { type: 'string' },
              examples: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    src: { type: 'string' },
                    tgt: { type: 'string' }
                  },
                  required: ['src', 'tgt']
                }
              }
            },
            required: ['pos', 'gloss_tl']
          }
        },
        synonyms: { type: 'array', items: { type: 'string' } }
      },
      required: ['headword', 'senses']
    };
    
    L.info('POST chrome-ai define');
    const raw = await withLanguageModelSession({
      initialPrompts: [{ role: 'system', content: systemText }]
    }, signal, session => withTimeout(session.prompt(userText, {
      responseConstraint: { schema },
      signal
    }), this.timeouts.dict));
    let dictionary;
    try { dictionary = JSON.parse(raw); }
    catch { dictionary = null; }

    if (!dictionary) {
      dictionary = { headword: text, phonetic: null, senses: [{ pos: '', gloss_tl: raw || '', examples: [] }], synonyms: [] };
    } else {
      dictionary = normalizeDictionary(dictionary, text);
    }

    L.info('define ok', { senses: dictionary.senses.length });
    return { dictionary, raw, think: '', mode: 'dictionary', provider: this.id };
  }

  async visionTranslate({ imageDataUrl, targetLang, signal }) {
    const dataUrlToBlob = async (dataUrl) => {
      const res = await fetch(dataUrl, { signal });
      return await res.blob();
    };

    const imageBlob = await dataUrlToBlob(imageDataUrl);
    const promptContent = [
      { type: 'text', value: `Target language: ${targetLang}\nTranslate visible text from this image. Output translation only.` },
      { type: 'image', value: imageBlob }
    ];
    
    L.info('POST chrome-ai vision');
    const result = await withLanguageModelSession({}, signal, session => withTimeout(
      session.prompt([{ role: 'user', content: promptContent }], { signal }),
      this.timeouts.vision
    ));
    const translated = result.trim();

    L.info('vision ok', { outLen: translated.length });
    return { translated, raw: result, mode: 'translate', provider: this.id };
  }
}
