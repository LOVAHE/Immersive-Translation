import { BaseTranslator } from './base.js';
import { withTimeout } from '../core/utils.js';
import { createLogger } from '../core/log.js';

const L = createLogger('prov-google');

export class GoogleTranslate extends BaseTranslator {
  id = 'google'; label = 'Google Translate';

  async translate({ text, sourceLang='auto', targetLang, signal }) {
    if (!this.config.apiKey) throw new Error('Google API key missing');
    const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(this.config.apiKey)}`;
    const body = { q: text, target: targetLang, format: 'text', ...(sourceLang !== 'auto' ? { source: sourceLang } : {}) };
    L.info('POST', 'google translate', { target: targetLang, source: sourceLang });
    const res = await withTimeout(fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body), signal }));
    L.info('status', res.status);
    if (!res.ok) { L.error('translate error', { status: res.status }); throw new Error(`Google API ${res.status}`); }
    const data = await res.json();
    const translated = data?.data?.translations?.[0]?.translatedText || '';
    L.info('translate ok', { outLen: translated.length });
    return { translated, raw: data };
  }

  async define({ text, sourceLang='auto', targetLang, signal }) {
    const t = await this.translate({ text, sourceLang, targetLang, signal });
    return { dictionary: { headword: text, phonetic: null, senses: [{ pos:'', gloss: t.translated, examples: [] }], synonyms: [] }, raw: t.raw };
  }
}
