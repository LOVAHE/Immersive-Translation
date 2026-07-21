// prompts/common.js

const DEFAULT_TRANSLATE_SYSTEM =
  'You are a high-quality translation engine. Preserve meaning, tone, style, and formatting (punctuation, code, links, and line breaks). Output ONLY the translation in the target language.';
const DEFAULT_TRANSLATE_USER_INSTRUCTION =
  'Translate the runtime input text. Output only the translation.';
const DEFAULT_DICTIONARY_USER_INSTRUCTION =
  'Build a concise learner-friendly dictionary entry for the runtime input word. Return JSON only.';

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function withRuntimeInput(instruction, payload) {
  return `${instruction}\n\nRUNTIME INPUT:\n${JSON.stringify(payload, null, 2)}`;
}
/**
 * Build translation prompts.
 */
export function buildTranslatePrompt({
  text,
  sourceLang = 'auto',
  targetLang,
  systemOverride,
  userOverride
}) {
  const runtimeInput = {
    sourceLang: String(sourceLang || 'auto'),
    targetLang: String(targetLang || ''),
    text: String(text ?? '')
  };
  const systemText = trimmed(systemOverride) || DEFAULT_TRANSLATE_SYSTEM;
  const userText = withRuntimeInput(
    trimmed(userOverride) || DEFAULT_TRANSLATE_USER_INSTRUCTION,
    runtimeInput
  );

  return { systemText, userText };
}

/**
 * Build dictionary (single-word) prompts.
 * The UI expects strict JSON with "gloss_tl" and examples [{src,tgt}].
 */
export function buildDictionaryPrompt({
  text,
  sourceLang = 'auto',
  targetLang,
  systemOverride,
  userOverride
}) {
  const runtimeInput = {
    sourceLang: String(sourceLang || 'auto'),
    targetLang: String(targetLang || ''),
    word: String(text ?? '')
  };
  const systemText =
    trimmed(systemOverride) ||
`You are a bilingual learner's dictionary.
Return STRICT JSON only in this exact shape:
{
  "headword": string,
  "phonetic": string|null,
  "senses": [
    { "pos": string, "gloss_tl": string, "examples": [ { "src": string, "tgt": string } ] }
  ],
  "synonyms": string[]
}
Rules:
- "gloss_tl" MUST be written in the TARGET language <${runtimeInput.targetLang}>.
- Examples: "src" is a natural sentence in SOURCE; "tgt" is its translation in TARGET <${runtimeInput.targetLang}>.
- Include up to 5 concise senses. Do NOT add commentary.`;
  const userText = withRuntimeInput(
    trimmed(userOverride) || DEFAULT_DICTIONARY_USER_INSTRUCTION,
    runtimeInput
  );

  return { systemText, userText };
}
