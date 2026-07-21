import assert from 'node:assert/strict';
import test from 'node:test';

import { createPublicTranslationResult } from '../core/router.js';

test('public translation results omit provider raw payloads', () => {
  const result = createPublicTranslationResult(
    {
      translated: 'bonjour',
      raw: { requestId: 'provider-private', sensitiveEcho: 'source text' },
      mode: 'provider-mode',
      provider: 'provider-supplied'
    },
    {
      mode: 'translate',
      provider: 'openai',
      sourceLang: 'en',
      targetLang: 'fr',
      text: 'hello'
    }
  );

  assert.equal(Object.hasOwn(result, 'raw'), false);
  assert.equal(result.translated, 'bonjour');
  assert.equal(result.mode, 'translate');
  assert.equal(result.provider, 'openai');
  assert.equal(result.sourceLang, 'en');
  assert.equal(result.targetLang, 'fr');
});
