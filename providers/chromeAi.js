// providers/chromeAi.js
import { BaseTranslator } from './base.js';
import { withTimeout } from '../core/utils.js';
import { createLogger } from '../core/log.js';
import { buildTranslatePrompt, buildDictionaryPrompt } from '../prompts/common.js';

const L = createLogger('prov-chrome-ai');

export class ChromeAiTranslate extends BaseTranslator {
  id = 'chrome-ai';
  label = 'Chrome AI (Local)';
  
  constructor(cfg) {
    super(cfg || {});
    this.timeouts = { translate: 30000, dict: 30000, vision: 30000 };
  }

  static async getAvailability() {
    try {
      if (typeof window.ai?.LanguageModel?.availability !== 'function') {
        return 'unavailable';
      }
      return await window.ai.LanguageModel.availability();
    } catch (e) {
      L.error('getAvailability error', e);
      return 'unavailable';
    }
  }

  async translate({ text, sourceLang = 'auto', targetLang }) {
    const { systemText, userText } = buildTranslatePrompt({
      text, sourceLang, targetLang,
      systemOverride: this.config.promptTranslateSystem,
      userOverride: this.config.promptTranslateUser
    });

    const session = await window.ai.LanguageModel.create({
      initialPrompts: [{ role: 'system', content: systemText }]
    });

    L.info('POST chrome-ai translate');
    const result = await withTimeout(session.prompt(userText), this.timeouts.translate);

    // The Gemini provider has a `extractThink` helper. We don't have that concept here,
    // so we just return the text directly.
    const translated = result.trim();

    L.info('translate ok', { outLen: translated.length });
    return { translated, raw: result, think: '', mode: 'translate', provider: this.id };
  }

  async define({ text, targetLang, sourceLang = 'auto' }) {
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
    
    const session = await window.ai.LanguageModel.create({
      initialPrompts: [{ role: 'system', content: systemText }]
    });

    L.info('POST chrome-ai define');
    const raw = await withTimeout(session.prompt(userText, { responseConstraint: { schema } }), this.timeouts.dict);
    let dictionary;
    try { dictionary = JSON.parse(raw); }
    catch { dictionary = null; }

    if (!dictionary) {
      dictionary = { headword: text, phonetic: null, senses: [{ pos: '', gloss_tl: raw || '', examples: [] }], synonyms: [] };
    } else {
      // Clean up the response, similar to the gemini provider
      if (Array.isArray(dictionary.senses)) {
        dictionary.senses = dictionary.senses.map(s => ({
          pos: s.pos || '',
          gloss_tl: s.gloss_tl || s.gloss || '',
          examples: Array.isArray(s.examples)
            ? s.examples.map(e => ({ src: e.src ?? e.en ?? '', tgt: e.tgt ?? e.tl ?? '' }))
            : []
        }));
      } else { dictionary.senses = []; }
      if (!Array.isArray(dictionary.synonyms)) dictionary.synonyms = [];
      if (typeof dictionary.headword !== 'string') dictionary.headword = String(text);
      if (dictionary.phonetic !== null && typeof dictionary.phonetic !== 'string') dictionary.phonetic = null;
    }

    L.info('define ok', { senses: dictionary.senses.length });
    return { dictionary, raw, think: '', mode: 'dictionary', provider: this.id };
  }

  async visionTranslate({ imageDataUrl, targetLang }) {
    const dataUrlToBlob = async (dataUrl) => {
      const res = await fetch(dataUrl);
      return await res.blob();
    };

    const imageBlob = await dataUrlToBlob(imageDataUrl);
    const session = await window.ai.LanguageModel.create();

    const promptContent = [
      { type: 'text', value: `Target language: ${targetLang}\nTranslate visible text from this image. Output translation only.` },
      { type: 'image', value: imageBlob }
    ];
    
    L.info('POST chrome-ai vision');
    const result = await withTimeout(session.prompt([{ role: 'user', content: promptContent }]), this.timeouts.vision);
    const translated = result.trim();

    L.info('vision ok', { outLen: translated.length });
    return { translated, raw: result, mode: 'translate', provider: this.id };
  }
}
