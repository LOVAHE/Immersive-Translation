// prompts/common.js
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
  const systemText =
    (systemOverride && systemOverride.trim()) ||
    `You are a high-quality translation engine. Preserve meaning, tone, style, and formatting (punctuation, code, links, and line breaks). Output ONLY the translation in the target language.`;

  const userText =
    (userOverride && userOverride.trim()) ||
    `Translate into: ${targetLang}
Source may be: ${sourceLang}

---
${text}`;

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
  const systemText =
    (systemOverride && systemOverride.trim()) ||
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
- "gloss_tl" MUST be written in the TARGET language <${targetLang}>.
- Examples: "src" is a natural sentence in SOURCE; "tgt" is its translation in TARGET <${targetLang}>.
- Include up to 5 concise senses. Do NOT add commentary.`;

  const userText =
    (userOverride && userOverride.trim()) ||
    `SOURCE language: ${sourceLang}
TARGET language: ${targetLang}
WORD: ${text}

Return JSON only.`;

  return { systemText, userText };
}
