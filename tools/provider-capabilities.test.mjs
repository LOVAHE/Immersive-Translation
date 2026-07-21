import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getProviderDefinition,
  providerSupports,
  resolveProviderId
} from '../providers/catalog.js';
import { shouldUseDictionary } from '../core/providerRouting.js';
import { getProvider } from '../providers/index.js';

test('provider capabilities match the supported runtime implementations', () => {
  assert.equal(providerSupports('openai', 'dictionary'), true);
  assert.equal(providerSupports('gemini', 'dictionary'), true);
  assert.equal(providerSupports('azure', 'dictionary'), true);
  assert.equal(providerSupports('chrome-ai', 'dictionary'), true);
  assert.equal(providerSupports('google', 'dictionary'), false);
  assert.equal(providerSupports('deepl', 'dictionary'), false);
  assert.equal(providerSupports('codex', 'dictionary'), false);

  assert.equal(providerSupports('gemini', 'vision'), true);
  assert.equal(providerSupports('chrome-ai', 'vision'), true);
  assert.equal(providerSupports('openai', 'vision'), false);
  assert.equal(providerSupports('codex', 'vision'), false);
});

test('Chrome AI is explicitly experimental', () => {
  const definition = getProviderDefinition('chrome-ai');

  assert.equal(definition.experimental, true);
  assert.match(definition.label, /Experimental/i);
});

test('Codex is explicitly experimental and resolves to its native provider', () => {
  const definition = getProviderDefinition('codex');

  assert.equal(definition.experimental, true);
  assert.match(definition.label, /Experimental/i);
  assert.equal(getProvider('codex', {}).id, 'codex');
});

test('unknown provider ids consistently resolve to OpenAI', () => {
  assert.equal(resolveProviderId('unknown-provider'), 'openai');
  assert.equal(getProviderDefinition('unknown-provider').id, 'openai');
  assert.equal(getProvider('unknown-provider', {}).id, 'openai');
});

test('dictionary routing enables Azure but keeps Google and DeepL in translation mode', () => {
  const common = { probablyWord: true, enabled: true };

  assert.equal(shouldUseDictionary({ ...common, providerId: 'azure' }), true);
  assert.equal(shouldUseDictionary({ ...common, providerId: 'google' }), false);
  assert.equal(shouldUseDictionary({ ...common, providerId: 'deepl' }), false);
  assert.equal(shouldUseDictionary({ ...common, providerId: 'openai' }), true);
  assert.equal(shouldUseDictionary({ ...common, probablyWord: false, providerId: 'azure' }), false);
  assert.equal(shouldUseDictionary({ ...common, enabled: false, providerId: 'azure' }), false);
});
