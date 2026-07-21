import assert from 'node:assert/strict';
import test from 'node:test';

import { createLogger, setDebugLogging } from '../core/log.js';
import { OpenAIChatTranslate } from '../providers/openai.js';

function captureConsole() {
  const calls = [];
  const originals = {};

  for (const level of ['debug', 'log', 'warn', 'error']) {
    originals[level] = console[level];
    console[level] = (...args) => calls.push({ level, args });
  }

  return {
    calls,
    restore() {
      for (const [level, fn] of Object.entries(originals)) console[level] = fn;
    }
  };
}

test('debug and info logs are off by default and enabled explicitly', () => {
  const capture = captureConsole();
  try {
    const logger = createLogger('test');
    setDebugLogging(false);
    logger.debug('hidden debug');
    logger.info('hidden info');
    logger.warn('visible warning');
    logger.error('visible error');

    assert.deepEqual(capture.calls.map(call => call.level), ['warn', 'error']);

    setDebugLogging(true);
    logger.debug('visible debug');
    logger.info('visible info');
    assert.deepEqual(capture.calls.map(call => call.level), ['warn', 'error', 'debug', 'log']);
  } finally {
    setDebugLogging(false);
    capture.restore();
  }
});

test('OpenAI errors never log the provider response body', { concurrency: false }, async () => {
  const capture = captureConsole();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('SENSITIVE_RESPONSE_BODY', { status: 400 });

  try {
    setDebugLogging(true);
    const provider = new OpenAIChatTranslate({ apiKey: 'test' });
    await assert.rejects(
      provider._callChat([{ role: 'user', content: 'SENSITIVE_USER_TEXT' }]),
      /OpenAI chat 400/
    );

    const output = JSON.stringify(capture.calls);
    assert.doesNotMatch(output, /SENSITIVE_RESPONSE_BODY/);
    assert.doesNotMatch(output, /SENSITIVE_USER_TEXT/);
    assert.match(output, /400/);
  } finally {
    setDebugLogging(false);
    globalThis.fetch = originalFetch;
    capture.restore();
  }
});
