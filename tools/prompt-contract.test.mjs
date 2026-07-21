import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDictionaryPrompt, buildTranslatePrompt } from '../prompts/common.js';

const RUNTIME_MARKER = '\n\nRUNTIME INPUT:\n';

function runtimePayload(userText) {
  const markerIndex = userText.indexOf(RUNTIME_MARKER);
  assert.notEqual(markerIndex, -1, 'prompt must contain the runtime input marker');
  return JSON.parse(userText.slice(markerIndex + RUNTIME_MARKER.length));
}

test('custom translation user text remains an instruction and cannot replace runtime input', () => {
  const prompt = buildTranslatePrompt({
    text: 'dynamic translation text',
    sourceLang: 'ja',
    targetLang: 'fr',
    userOverride: 'Use a formal register.'
  });

  assert.ok(prompt.userText.startsWith('Use a formal register.'));
  assert.deepEqual(runtimePayload(prompt.userText), {
    sourceLang: 'ja',
    targetLang: 'fr',
    text: 'dynamic translation text'
  });
});

test('custom dictionary user text cannot replace the word or language pair', () => {
  const prompt = buildDictionaryPrompt({
    text: 'dynamic-word',
    sourceLang: 'en',
    targetLang: 'zh',
    userOverride: 'Prefer concise learner-friendly definitions.'
  });

  assert.ok(prompt.userText.startsWith('Prefer concise learner-friendly definitions.'));
  assert.deepEqual(runtimePayload(prompt.userText), {
    sourceLang: 'en',
    targetLang: 'zh',
    word: 'dynamic-word'
  });
});

test('default prompts use the same explicit runtime payload contract', () => {
  const translation = buildTranslatePrompt({ text: 'hello', targetLang: 'de' });
  const dictionary = buildDictionaryPrompt({ text: 'hello', targetLang: 'de' });

  assert.deepEqual(runtimePayload(translation.userText), {
    sourceLang: 'auto',
    targetLang: 'de',
    text: 'hello'
  });
  assert.deepEqual(runtimePayload(dictionary.userText), {
    sourceLang: 'auto',
    targetLang: 'de',
    word: 'hello'
  });
});

test('system overrides remain complete replacements', () => {
  const translation = buildTranslatePrompt({
    text: 'hello',
    targetLang: 'de',
    systemOverride: 'Custom translation system instruction.'
  });
  const dictionary = buildDictionaryPrompt({
    text: 'hello',
    targetLang: 'de',
    systemOverride: 'Custom dictionary system instruction.'
  });

  assert.equal(translation.systemText, 'Custom translation system instruction.');
  assert.equal(dictionary.systemText, 'Custom dictionary system instruction.');
});
