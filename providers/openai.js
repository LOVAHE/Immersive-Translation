// providers/openai.js
import { BaseTranslator } from './base.js';
import { normalizeDictionary } from './dictionary.js';
import { createLogger } from '../core/log.js';
import { buildTranslatePrompt, buildDictionaryPrompt } from '../prompts/common.js';

const L = createLogger('prov-openai');

function extractThink(s = '') {
  let think = '';
  if (typeof s !== 'string') return { text: s, think };
  const m = /<think>([\s\S]*?)<\/think>/i.exec(s);
  if (m) {
    think = m[1].trim();
    s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
  }
  return { text: s, think };
}

function defaultBaseUrl(u) {
  const x = (u || '').trim();
  return x || 'https://api.openai.com/v1';
}

export class OpenAIChatTranslate extends BaseTranslator {
  id = 'openai';
  label = 'OpenAI';

  constructor(cfg) {
    super(cfg || {});
    this.apiKey = this.config.apiKey;
    this.baseUrl = defaultBaseUrl(this.config.baseUrl);
    this.model   = this.config.model || 'gpt-4o-mini';
    this.jsonModeSupported = this.config.jsonModeSupported !== false;
    this.timeouts = { translate: 30000, dict: 30000 };
  }

  _headers(json = true) {
    if (!this.apiKey) throw new Error('OpenAI API key missing');
    const h = { 'Authorization': `Bearer ${this.apiKey}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  _url(path) { return `${this.baseUrl.replace(/\/+$/,'')}/${path.replace(/^\/+/, '')}`; }

  async _callChat(messages, { json = false, signal } = {}) {
    const body = { model: this.model, messages, temperature: 0.2 };
    if (json && this.jsonModeSupported) {
      body.response_format = { type: 'json_object' };
    }
    const res = await fetch(this._url('chat/completions'), {
      method: 'POST', headers: this._headers(true), body: JSON.stringify(body), signal
    });
    const raw = await res.text().catch(()=> '');
    let data; try { data = JSON.parse(raw || '{}'); } catch { data = { raw }; }
    if (!res.ok) {
      L.error('openai chat error', { status: res.status });
      throw new Error(`OpenAI chat ${res.status}`);
    }
    return data;
  }

  _extractContent(data) {
    const msg = data?.choices?.[0]?.message;
    if (msg?.content) return String(msg.content);
    if (typeof data?.output_text === 'string') return data.output_text;
    if (Array.isArray(data?.output)) return data.output.map(p => p?.content ?? p?.text ?? '').join('');
    return '';
  }

  async translate({ text, sourceLang = 'auto', targetLang, signal }) {
    const { systemText, userText } = buildTranslatePrompt({
      text, sourceLang, targetLang,
      systemOverride: this.config.promptTranslateSystem,
      userOverride:   this.config.promptTranslateUser
    });

    const data = await this._callChat(
      [{ role:'system', content: systemText }, { role:'user', content: userText }],
      { json: false, signal }
    );

    const raw = this._extractContent(data);
    const { text: clean, think } = extractThink(raw);

    L.info('translate ok', { outLen: clean.length });
    return { translated: clean, raw: data, think, mode: 'translate', provider: this.id };
  }

  async define({ text, sourceLang = 'auto', targetLang, signal }) {
    const { systemText, userText } = buildDictionaryPrompt({
      text, sourceLang, targetLang,
      systemOverride: this.config.promptDictSystem,
      userOverride:   this.config.promptDictUser
    });

    const data = await this._callChat(
      [{ role:'system', content: systemText }, { role:'user', content: userText }],
      { json: true, signal } // ask for JSON
    );

    let s = this._extractContent(data);
    const { text: clean, think } = extractThink(s);

    let dictionary;
    try {
      dictionary = JSON.parse(clean);
    } catch {
      const m = (clean || '').match(/\{[\s\S]*\}/);
      dictionary = m ? JSON.parse(m[0]) : null;
    }
    if (!dictionary) {
      dictionary = { headword: text, phonetic: null, senses: [], synonyms: [] };
    } else {
      dictionary = normalizeDictionary(dictionary, text);
    }

    L.info('define ok', { senses: dictionary.senses.length });
    return { dictionary, raw: data, think, mode: 'dictionary', provider: this.id };
  }
}
