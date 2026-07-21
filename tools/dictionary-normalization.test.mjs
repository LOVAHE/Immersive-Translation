import assert from 'node:assert/strict';
import test from 'node:test';

import { ChromeAiTranslate } from '../providers/chromeAi.js';
import { normalizeDictionary } from '../providers/dictionary.js';
import { GeminiTranslate } from '../providers/gemini.js';
import { OpenAIChatTranslate } from '../providers/openai.js';
import { AzureTranslate } from '../providers/azureTranslate.js';

test('normalizes legacy dictionary field aliases in place', () => {
  const dictionary = {
    headword: 42,
    phonetic: 7,
    senses: [{
      pos: null,
      gloss: 'meaning',
      examples: [
        { en: 'legacy source', tl: 'legacy target' },
        { src: 'source', tgt: 'target' }
      ]
    }],
    synonyms: 'not-an-array'
  };

  const normalized = normalizeDictionary(dictionary, 'fallback');

  assert.strictEqual(normalized, dictionary);
  assert.deepEqual(normalized, {
    headword: 'fallback',
    phonetic: null,
    senses: [{
      pos: '',
      gloss_tl: 'meaning',
      examples: [
        { src: 'legacy source', tgt: 'legacy target' },
        { src: 'source', tgt: 'target' }
      ]
    }],
    synonyms: []
  });
});

test('preserves canonical fields and fills missing collections', () => {
  const dictionary = {
    headword: 'word',
    phonetic: null,
    senses: 'not-an-array',
    synonyms: ['term']
  };

  assert.deepEqual(normalizeDictionary(dictionary, 'fallback'), {
    headword: 'word',
    phonetic: null,
    senses: [],
    synonyms: ['term']
  });
});

test('uses an empty string for missing sense and example fields', () => {
  const dictionary = {
    headword: 'word',
    phonetic: '/wɜːd/',
    senses: [{ examples: [{}] }]
  };

  assert.deepEqual(normalizeDictionary(dictionary, 'fallback'), {
    headword: 'word',
    phonetic: '/wɜːd/',
    senses: [{ pos: '', gloss_tl: '', examples: [{ src: '', tgt: '' }] }],
    synonyms: []
  });
});

test('OpenAI keeps its empty dictionary fallback when JSON parsing fails', async () => {
  const provider = new OpenAIChatTranslate({ apiKey: 'test' });
  provider._callChat = async () => ({
    choices: [{ message: { content: 'not json' } }]
  });

  const result = await provider.define({ text: 'word', targetLang: 'zh' });

  assert.deepEqual(result.dictionary, {
    headword: 'word',
    phonetic: null,
    senses: [],
    synonyms: []
  });
});

test('Azure dictionary examples use the shared src/tgt contract', async () => {
  const provider = new AzureTranslate({ key: 'test' });
  provider._loadDictLangs = async () => new Set(['en', 'zh-Hans']);
  provider._post = async path => {
    assert.equal(path, 'dictionary/lookup');
    return [{
      translations: [{
        posTag: 'NOUN',
        displayTarget: '你好',
        normalizedTarget: '你好',
        backTranslations: [{ displayText: 'hello' }]
      }]
    }];
  };

  const result = await provider.define({
    text: 'hello',
    sourceLang: 'en',
    targetLang: 'zh'
  });

  assert.deepEqual(result.dictionary.senses[0].examples, [
    { src: 'hello', tgt: '你好' }
  ]);
  assert.equal(Object.hasOwn(result.dictionary.senses[0].examples[0], 'en'), false);
  assert.equal(Object.hasOwn(result.dictionary.senses[0].examples[0], 'tl'), false);
});

test('Gemini keeps response text in its fallback sense when JSON parsing fails', { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'not json' }] } }]
  }), { status: 200 });

  try {
    const provider = new GeminiTranslate({ apiKey: 'test' });
    const result = await provider.define({ text: 'word', targetLang: 'zh' });

    assert.deepEqual(result.dictionary, {
      headword: 'word',
      phonetic: null,
      senses: [{ pos: '', gloss_tl: 'not json', examples: [] }],
      synonyms: []
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Chrome AI keeps response text in its fallback sense when JSON parsing fails', { concurrency: false }, async () => {
  const originalAi = globalThis.ai;
  globalThis.ai = {
    LanguageModel: {
      create: async () => ({ prompt: async () => 'not json' })
    }
  };

  try {
    const provider = new ChromeAiTranslate({});
    const result = await provider.define({ text: 'word', targetLang: 'zh' });

    assert.deepEqual(result.dictionary, {
      headword: 'word',
      phonetic: null,
      senses: [{ pos: '', gloss_tl: 'not json', examples: [] }],
      synonyms: []
    });
  } finally {
    globalThis.ai = originalAi;
  }
});
