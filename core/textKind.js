export function classifyText(text) {
  const t = (text || '').trim();
  if (!t) return { probablyWord: false, normalized: '' };
  const wordLike = /^[\p{L}\p{N}’'\-]+$/u.test(t);
  const hasSpace = /\s/.test(t);
  const isCJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(t);
  const tooLong = t.length > 48;
  const probablyWord = wordLike && !hasSpace && !tooLong && !/[.,!?;:]/.test(t) && !isCJK;
  return { probablyWord, normalized: t };
}
