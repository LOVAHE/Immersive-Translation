import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BATCH_SEPARATOR,
  createBatchPayload,
  splitBatchTranslation
} from '../core/batchTranslation.js';

test('batch payload and exact response preserve order and cardinality', () => {
  const source = ['one', 'two', 'three'];
  const payload = createBatchPayload(source);
  const result = splitBatchTranslation(`uno${BATCH_SEPARATOR}dos${BATCH_SEPARATOR}tres`, source.length);

  assert.equal(payload, `one${BATCH_SEPARATOR}two${BATCH_SEPARATOR}three`);
  assert.deepEqual(result.items, ['uno', 'dos', 'tres']);
  assert.equal(result.matched, true);
});

test('missing results are padded without changing expected cardinality', () => {
  const result = splitBatchTranslation(`uno${BATCH_SEPARATOR}dos`, 4);

  assert.deepEqual(result.items, ['uno', 'dos', '', '']);
  assert.equal(result.actualCount, 2);
  assert.equal(result.expectedCount, 4);
  assert.equal(result.matched, false);
});

test('extra results are truncated without spilling into another chunk', () => {
  const firstChunk = splitBatchTranslation(`a${BATCH_SEPARATOR}b${BATCH_SEPARATOR}extra`, 2);
  const secondChunk = splitBatchTranslation(`c${BATCH_SEPARATOR}d`, 2);

  assert.deepEqual([...firstChunk.items, ...secondChunk.items], ['a', 'b', 'c', 'd']);
  assert.equal(firstChunk.matched, false);
  assert.equal(secondChunk.matched, true);
});

test('a modified or missing separator is reported and padded locally', () => {
  const result = splitBatchTranslation('combined translation without separator', 3);

  assert.deepEqual(result.items, ['combined translation without separator', '', '']);
  assert.equal(result.matched, false);
});

test('zero-length batches remain empty', () => {
  assert.deepEqual(splitBatchTranslation('', 0), {
    items: [],
    expectedCount: 0,
    actualCount: 0,
    matched: true
  });
});
