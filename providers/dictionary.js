/**
 * Normalize a parsed dictionary response for the dictionary bubble contract.
 *
 * Callers own parsing and fallback-content decisions. This function deliberately
 * mutates and returns the supplied object so provider return semantics stay the
 * same while the shared field aliases remain consistent.
 */
export function normalizeDictionary(dictionary, fallbackHeadword) {
  if (Array.isArray(dictionary.senses)) {
    dictionary.senses = dictionary.senses.map(sense => ({
      pos: sense.pos || '',
      gloss_tl: sense.gloss_tl || sense.gloss || '',
      examples: Array.isArray(sense.examples)
        ? sense.examples.map(example => ({
            src: example.src ?? example.en ?? '',
            tgt: example.tgt ?? example.tl ?? ''
          }))
        : []
    }));
  } else {
    dictionary.senses = [];
  }

  if (!Array.isArray(dictionary.synonyms)) dictionary.synonyms = [];
  if (typeof dictionary.headword !== 'string') dictionary.headword = String(fallbackHeadword);
  if (dictionary.phonetic !== null && typeof dictionary.phonetic !== 'string') dictionary.phonetic = null;

  return dictionary;
}
