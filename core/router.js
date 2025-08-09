import { getSettings } from './settings.js';
import { getProvider } from '../providers/index.js';
import { classifyText } from './textKind.js';

export async function handleTranslate({ text, sourceLang, targetLang, intent }) {
  if (!text || !text.trim()) throw new Error('No text to translate');
  const s = await getSettings();
  const provider = getProvider(s.provider || 'openai', s);
  const tgt = targetLang || s.targetLang || 'zh';
  const src = sourceLang || s.sourceLang || 'auto';
  const { probablyWord } = classifyText(text);
  const useDict = probablyWord && s.enableWordDictionary && typeof provider.define === 'function';
  const payload = { text, sourceLang: src, targetLang: tgt, context: { intent } };
  const out = useDict ? await provider.define(payload) : await provider.translate(payload);
  return { mode: useDict ? 'dictionary' : 'translate', ...out, provider: provider.id, sourceLang: src, targetLang: tgt, text };
}
