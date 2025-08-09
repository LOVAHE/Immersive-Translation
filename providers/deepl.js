import { BaseTranslator } from './base.js';
import { withTimeout } from '../core/utils.js';
import { createLogger } from '../core/log.js';

const L = createLogger('prov-deepl');

export class DeepLTranslate extends BaseTranslator {
  id = 'deepl'; label = 'DeepL';

  async translate({ text, sourceLang='auto', targetLang }) {
    if (!this.config.key) throw new Error('DeepL key missing');
    const endpoint = 'https://api.deepl.com/v2/translate';
    const params = new URLSearchParams();
    params.set('auth_key', this.config.key);
    params.set('text', text);
    params.set('target_lang', targetLang.toUpperCase());
    if (sourceLang !== 'auto') params.set('source_lang', sourceLang.toUpperCase());
    L.info('POST', 'deepl translate', { target: targetLang, source: sourceLang });
    const res = await withTimeout(fetch(endpoint, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: params }));
    L.info('status', res.status);
    if (!res.ok) { const t = await res.text().catch(()=> ''); L.error('error body', t.slice(0,500)); throw new Error(`DeepL API ${res.status}`); }
    const data = await res.json();
    const translated = data?.translations?.[0]?.text || '';
    L.info('translate ok', { outLen: translated.length });
    return { translated, raw: data };
  }

  async define({ text, sourceLang='auto', targetLang }) {
    const t = await this.translate({ text, sourceLang, targetLang });
    return { dictionary: { headword: text, phonetic: null, senses: [{ pos:'', gloss: t.translated, examples: [] }], synonyms: [] }, raw: t.raw };
  }
}
