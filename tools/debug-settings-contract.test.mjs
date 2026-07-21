import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { applyDebugSettingChange } from '../core/debugSettings.js';

test('debug setting changes are applied only for synchronized debug updates', () => {
  const applied = [];
  const apply = value => applied.push(value);

  assert.equal(applyDebugSettingChange({ debug: { newValue: true } }, 'local', apply), false);
  assert.equal(applyDebugSettingChange({ uiLang: { newValue: 'zh' } }, 'sync', apply), false);
  assert.equal(applyDebugSettingChange({ debug: { newValue: true } }, 'sync', apply), true);
  assert.equal(applyDebugSettingChange({ debug: { newValue: false } }, 'sync', apply), true);
  assert.deepEqual(applied, [true, false]);
});

test('the offscreen realm subscribes to storage changes and applies debug updates locally', async () => {
  const source = await readFile(new URL('../offscreen/offscreen.js', import.meta.url), 'utf8');

  assert.match(source, /storage\.onChanged\.addListener/);
  assert.match(source, /applyDebugSettingChange\(changes, area\)/);
});
