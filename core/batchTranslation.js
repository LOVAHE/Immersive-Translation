export const BATCH_SEPARATOR = '\n\u2063\u2063\u2063\n';

export function createBatchPayload(items = []) {
  return items.map(item => String(item ?? '')).join(BATCH_SEPARATOR);
}

/**
 * Return exactly one slot per requested item.
 *
 * Providers may drop or add separators. Padding and truncation keep any
 * mismatch local to the current chunk so it cannot shift later chunks.
 */
export function splitBatchTranslation(translated, expectedCount) {
  if (!Number.isInteger(expectedCount) || expectedCount < 0) {
    throw new TypeError('expectedCount must be a non-negative integer');
  }
  if (expectedCount === 0) {
    return { items: [], expectedCount: 0, actualCount: 0, matched: true };
  }

  const parts = String(translated ?? '').split(BATCH_SEPARATOR);
  const items = Array(expectedCount).fill('');
  for (let i = 0; i < Math.min(parts.length, expectedCount); i++) items[i] = parts[i];

  return {
    items,
    expectedCount,
    actualCount: parts.length,
    matched: parts.length === expectedCount
  };
}
