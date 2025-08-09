// providers/azure.js

import { BaseTranslator } from './base.js';
import { withTimeout } from '../core/utils.js';
import { createLogger } from '../core/log.js';
const L = createLogger('prov-azure');
const AZ_BASE = (cfg) => (cfg?.endpoint || 'https://api.cognitive.microsofttranslator.com').replace(/\/+$/,'');

function mapAzureLang(code = '') {
  const c = (code || '').toLowerCase();
  if (!c || c === 'auto') return '';
  if (c === 'zh' || c === 'zh-cn' || c === 'zh_sg') return 'zh-Hans';
  if (c === 'zh-tw' || c === 'zh-hk' || c === 'zh-mo') return 'zh-Hant';
  if (c === 'iw') return 'he';
  return code;
}

export class AzureTranslate extends BaseTranslator {
  id = 'azure'; label = 'Azure Translator';
  constructor(cfg){ super(cfg || {}); this._dictLangs = null; }

  _headers() {
    const { key, region } = this.config;
    if (!key) throw new Error('Azure Translator key missing');
    return {
      'Ocp-Apim-Subscription-Key': key,
      ...(region ? { 'Ocp-Apim-Subscription-Region': region } : {}),
      'Content-Type': 'application/json'
    };
  }

  async _post(path, params, body, timeoutMs = 20000) {
    const qs = new URLSearchParams({ 'api-version': '3.0', ...(params || {}) }).toString();
    const url = `${AZ_BASE(this.config)}/${path}?${qs}`;
    const res = await withTimeout(fetch(url, { method:'POST', headers: this._headers(), body: JSON.stringify(body || []) }), timeoutMs);
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
      L.error(`${path} error body`, text);
      throw new Error(`Azure ${path} ${res.status}`);
    }
    return await res.json();
  }

  async _get(path, params, timeoutMs = 15000) {
    const qs = new URLSearchParams({ 'api-version': '3.0', ...(params || {}) }).toString();
    const url = `${AZ_BASE(this.config)}/${path}?${qs}`;
    const res = await withTimeout(fetch(url, { headers: this._headers() }), timeoutMs);
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
      L.error(`${path} error body`, text);
      throw new Error(`Azure ${path} ${res.status}`);
    }
    return await res.json();
  }

  async _detect(text) {
    const data = await this._post('detect', null, [{ text }]);
    return data?.[0]?.language || '';
  }

  async _loadDictLangs() {
    if (this._dictLangs) return this._dictLangs;
    const data = await this._get('languages', { scope: 'dictionary' });
    const langsObj = data?.dictionary || {};
    this._dictLangs = new Set(Object.keys(langsObj));
    return this._dictLangs;
  }

  async translate({ text, sourceLang='auto', targetLang }) {
    const to = mapAzureLang(targetLang);
    const from = mapAzureLang(sourceLang);
    const params = { to };
    if (from) params.from = from;
    const data = await this._post('translate', params, [{ text }]);
    const translated = data?.[0]?.translations?.[0]?.text || '';
    return { translated, raw: data };
  }

  async define({ text, targetLang, sourceLang='auto' }) {
    const to = mapAzureLang(targetLang);
    let from = mapAzureLang(sourceLang);
    if (!from) {
      try { from = mapAzureLang(await this._detect(text) || 'en'); }
      catch (e) { L.warn('detect failed, fallback en', e); from = 'en'; }
    }

    try {
      const dictLangs = await this._loadDictLangs();
      if (!dictLangs.has(from) || !dictLangs.has(to)) {
        L.info('dict unsupported pair', { from, to });
        const out = await this.translate({ text, sourceLang: from, targetLang: to });
        return { dictionary: { headword: text, phonetic: null,
          senses: [{ pos:'', gloss: out.translated, gloss_tl: out.translated, examples: [] }], synonyms: [] },
          raw: { fallback: 'translate' } };
      }
    } catch (e) {
      L.warn('load dict langs failed, fallback translate', e);
      const out = await this.translate({ text, sourceLang: from, targetLang: to });
      return { dictionary: { headword: text, phonetic: null,
        senses: [{ pos:'', gloss: out.translated, gloss_tl: out.translated, examples: [] }], synonyms: [] },
        raw: { fallback: 'translate' } };
    }

    try {
      const resp = await this._post('dictionary/lookup', { from, to }, [{ text }]);
      const entries = resp?.[0]?.translations || [];
      const senses = entries.slice(0, 5).map(ent => ({
        pos: ent.posTag || '',
        gloss: ent.normalizedTarget || ent.displayTarget || '',
        gloss_tl: ent.normalizedTarget || ent.displayTarget || '',
        examples: (ent.backTranslations || []).slice(0, 2).map(bt => ({
          en: bt.displayText,
          tl: ent.displayTarget
        }))
      }));
      return { dictionary: { headword: text, phonetic: null, senses, synonyms: [] }, raw: resp };
    } catch (e) {
      L.warn('dictionary lookup failed, fallback translate', e);
      const out = await this.translate({ text, sourceLang: from, targetLang: to });
      return { dictionary: { headword: text, phonetic: null,
        senses: [{ pos:'', gloss: out.translated, gloss_tl: out.translated, examples: [] }], synonyms: [] },
        raw: { fallback: 'translate' } };
    }
  }
}
