// providers/gemini.js
import { BaseTranslator } from './base.js';
import { withTimeout } from '../core/utils.js';
import { createLogger } from '../core/log.js';
import { buildTranslatePrompt, buildDictionaryPrompt } from '../prompts/common.js';

const L = createLogger('prov-gemini');

function extractThink(s = '') {
  let think = '';
  if (typeof s !== 'string') return { text: s, think };
  const m = /<think>([\s\S]*?)<\/think>/i.exec(s);
  if (m) {
    think = m[1].trim();
    s = (s.slice(0, m.index) + s.slice(m.index + m[0].length)).trim();
  }
  s = s.replace(/^```json\s*/i, '').replace(/```$/i, '').trim(); // strip fences if any
  return { text: s, think };
}
function partsText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('');
}
function apiUrl(model, key) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
}

export class GeminiTranslate extends BaseTranslator {
  id = 'gemini'; label = 'Gemini';
  constructor(cfg){ super(cfg||{}); this.apiKey=this.config.apiKey; this.model=this.config.model||'gemini-2.5-flash'; this.timeouts={translate:30000, dict:30000, vision:30000}; }

  async translate({ text, sourceLang='auto', targetLang }) {
    if (!this.apiKey) throw new Error('Gemini key missing');

    const { systemText, userText } = buildTranslatePrompt({
      text, sourceLang, targetLang,
      systemOverride: this.config.promptTranslateSystem,
      userOverride:   this.config.promptTranslateUser
    });

    const body = {
      systemInstruction: { role:'system', parts:[{ text: systemText }] },
      contents: [{ role:'user', parts:[{ text: userText }] }],
      generationConfig: { temperature: 0 }
    };

    const url = apiUrl(this.model, this.apiKey);
    L.info('POST gemini translate', { model: this.model });
    const res = await withTimeout(fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }), this.timeouts.translate);
    const raw = await res.text().catch(()=> '');
    if (!res.ok) { L.error('translate error body', raw.slice(0,800)); throw new Error(`Gemini API ${res.status}`); }
    const data = JSON.parse(raw || '{}');

    const joined = partsText(data).trim();
    const { text: clean, think } = extractThink(joined);

    L.info('translate ok', { outLen: clean.length });
    return { translated: clean, raw: data, think, mode:'translate', provider: this.id };
  }

  async define({ text, targetLang, sourceLang='auto' }) {
    if (!this.apiKey) throw new Error('Gemini key missing');

    const { systemText, userText } = buildDictionaryPrompt({
      text, targetLang, sourceLang,
      systemOverride: this.config.promptDictSystem,
      userOverride:   this.config.promptDictUser
    });

    const body = {
      systemInstruction: { role:'system', parts:[{ text: systemText }] },
      contents: [{ role:'user', parts:[{ text: userText }] }],
      generationConfig: {
        temperature: 0,
        response_mime_type: 'application/json'
      }
    };

    const url = apiUrl(this.model, this.apiKey);
    L.info('POST gemini define', { model: this.model });
    const res = await withTimeout(fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }), this.timeouts.dict);
    const raw = await res.text().catch(()=> '');
    if (!res.ok) { L.error('define error body', raw.slice(0,800)); throw new Error(`Gemini API ${res.status}`); }
    const data = JSON.parse(raw || '{}');

    let txt = partsText(data) || '{}';
    const { text: clean, think } = extractThink(txt);

    let dictionary;
    try { dictionary = JSON.parse(clean); }
    catch { const m = clean.match(/\{[\s\S]*\}/); dictionary = m ? JSON.parse(m[0]) : null; }

    if (!dictionary) {
      dictionary = { headword:text, phonetic:null, senses:[{ pos:'', gloss_tl: clean || '', examples:[] }], synonyms:[] };
    } else {
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
    return { dictionary, raw: data, think, mode:'dictionary', provider: this.id };
  }

  async visionTranslate({ imageDataUrl, targetLang }) {
    if (!this.apiKey) throw new Error('Gemini key missing');
    const body = {
      contents:[{ role:'user', parts:[
        { text:`Target language: ${targetLang}\nTranslate visible text from this image. Output translation only.` },
        { inline_data:{ mime_type:'image/png', data: imageDataUrl.split(',')[1] } }
      ]}],
      generationConfig:{ temperature:0 }
    };
    const url = apiUrl(this.model, this.apiKey);
    L.info('POST gemini vision', { model:this.model });
    const res = await withTimeout(fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }), this.timeouts.vision);
    const raw = await res.text().catch(()=> '');
    if (!res.ok) { L.error('vision error body', raw.slice(0,800)); throw new Error(`Gemini API ${res.status}`); }
    const data = JSON.parse(raw || '{}');
    const translated = partsText(data).trim();
    L.info('vision ok', { outLen: translated.length });
    return { translated, raw: data, mode:'translate', provider: this.id };
  }
}
