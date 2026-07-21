// providers/azure.js

import { BaseTranslator } from './base.js';
import { isAbortError, withTimeout } from '../core/utils.js';
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

  async _post(path, params, body, signal, timeoutMs = 20000) {
    const qs = new URLSearchParams({ 'api-version': '3.0', ...(params || {}) }).toString();
    const url = `${AZ_BASE(this.config)}/${path}?${qs}`;
    const res = await withTimeout(fetch(url, { method:'POST', headers: this._headers(), body: JSON.stringify(body || []), signal }), timeoutMs);
    if (!res.ok) {
      L.error(`${path} error`, { status: res.status });
      throw new Error(`Azure ${path} ${res.status}`);
    }
    return await res.json();
  }

  async _get(path, params, signal, timeoutMs = 15000) {
    const qs = new URLSearchParams({ 'api-version': '3.0', ...(params || {}) }).toString();
    const url = `${AZ_BASE(this.config)}/${path}?${qs}`;
    const res = await withTimeout(fetch(url, { headers: this._headers(), signal }), timeoutMs);
    if (!res.ok) {
      L.error(`${path} error`, { status: res.status });
      throw new Error(`Azure ${path} ${res.status}`);
    }
    return await res.json();
  }

  async _detect(text, signal) {
    const data = await this._post('detect', null, [{ text }], signal);
    return data?.[0]?.language || '';
  }

  async _loadDictLangs(signal) {
    if (this._dictLangs) return this._dictLangs;
    const data = await this._get('languages', { scope: 'dictionary' }, signal);
    const langsObj = data?.dictionary || {};
    this._dictLangs = new Set(Object.keys(langsObj));
    return this._dictLangs;
  }

  async translate({ text, sourceLang='auto', targetLang, signal }) {
    const to = mapAzureLang(targetLang);
    const from = mapAzureLang(sourceLang);
    const params = { to };
    if (from) params.from = from;
    const data = await this._post('translate', params, [{ text }], signal);
    const translated = data?.[0]?.translations?.[0]?.text || '';
    return { translated, raw: data };
  }

  async define({ text, targetLang, sourceLang='auto', signal }) {
    const to = mapAzureLang(targetLang);
    let from = mapAzureLang(sourceLang);
    if (!from) {
      try { from = mapAzureLang(await this._detect(text, signal) || 'en'); }
      catch (e) {
        if (isAbortError(e, signal)) throw e;
        L.warn('detect failed, fallback en', e);
        from = 'en';
      }
    }

    try {
      const dictLangs = await this._loadDictLangs(signal);
      if (!dictLangs.has(from) || !dictLangs.has(to)) {
        L.info('dict unsupported pair', { from, to });
        const out = await this.translate({ text, sourceLang: from, targetLang: to, signal });
        return { dictionary: { headword: text, phonetic: null,
          senses: [{ pos:'', gloss: out.translated, gloss_tl: out.translated, examples: [] }], synonyms: [] },
          raw: { fallback: 'translate' } };
      }
    } catch (e) {
      if (isAbortError(e, signal)) throw e;
      L.warn('load dict langs failed, fallback translate', e);
      const out = await this.translate({ text, sourceLang: from, targetLang: to, signal });
      return { dictionary: { headword: text, phonetic: null,
        senses: [{ pos:'', gloss: out.translated, gloss_tl: out.translated, examples: [] }], synonyms: [] },
        raw: { fallback: 'translate' } };
    }

    try {
      const resp = await this._post('dictionary/lookup', { from, to }, [{ text }], signal);
      const entries = resp?.[0]?.translations || [];
      const senses = entries.slice(0, 5).map(ent => ({
        pos: ent.posTag || '',
        gloss: ent.normalizedTarget || ent.displayTarget || '',
        gloss_tl: ent.normalizedTarget || ent.displayTarget || '',
        examples: (ent.backTranslations || []).slice(0, 2).map(bt => ({
          src: bt.displayText,
          tgt: ent.displayTarget
        }))
      }));
      return { dictionary: { headword: text, phonetic: null, senses, synonyms: [] }, raw: resp };
    } catch (e) {
      if (isAbortError(e, signal)) throw e;
      L.warn('dictionary lookup failed, fallback translate', e);
      const out = await this.translate({ text, sourceLang: from, targetLang: to, signal });
      return { dictionary: { headword: text, phonetic: null,
        senses: [{ pos:'', gloss: out.translated, gloss_tl: out.translated, examples: [] }], synonyms: [] },
        raw: { fallback: 'translate' } };
    }
  }
}
