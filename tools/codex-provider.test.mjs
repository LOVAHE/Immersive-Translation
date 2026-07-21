import assert from 'node:assert/strict';
import test from 'node:test';

let responseFactory = request => request.method === 'health'
  ? {
      version: 2,
      id: request.id,
      ok: true,
      result: {
        service: 'ready',
        serviceVersion: '3.2.0',
        protocolVersion: 2,
        securityProfile: 'isolated-chatgpt-v2',
        sdkAvailable: true
      }
    }
  : ({
      version: 2,
      id: request.id,
      ok: true,
      result: {
        translations: [...request.params.items].reverse().map(item => ({ id: item.id, text: `translated:${item.text}` }))
      }
    });
let translationRequests = [];

class ListenerSet {
  listeners = new Set();
  addListener(listener) { this.listeners.add(listener); }
  emit(value) { for (const listener of this.listeners) listener(value); }
}

const port = {
  onMessage: new ListenerSet(),
  onDisconnect: new ListenerSet(),
  postMessage(request) {
    if (request.method === 'cancel') return;
    if (request.method === 'closeSession') {
      queueMicrotask(() => port.onMessage.emit({
        version: 2,
        id: request.id,
        ok: true,
        result: { sessionId: request.params.sessionId, closed: true }
      }));
      return;
    }
    if (request.method === 'translateBatch') translationRequests.push(request);
    queueMicrotask(() => port.onMessage.emit(responseFactory(request)));
  },
  disconnect() {}
};

globalThis.browser = {
  runtime: {
    connectNative(host) {
      assert.equal(host, 'com.adaptive_translation.codex');
      return port;
    }
  },
  permissions: { request: async () => true }
};

const [
  { BATCH_SEPARATOR },
  { CODEX_NATIVE_BATCH_LIMITS, CodexTranslate },
  companionLimits
] = await Promise.all([
  import('../core/batchTranslation.js'),
  import('../providers/codex.js'),
  import('../companion/src/constants.mjs')
]);

test('Codex extension batching limits match the separately packaged companion contract', () => {
  assert.deepEqual(CODEX_NATIVE_BATCH_LIMITS, {
    maxItems: companionLimits.MAX_BATCH_ITEMS,
    maxItemChars: companionLimits.MAX_ITEM_CHARS,
    maxBatchChars: companionLimits.MAX_BATCH_CHARS
  });
});

test('Codex provider preserves invisible batch separators and restores ID order', async () => {
  translationRequests = [];
  const provider = new CodexTranslate({});
  const result = await provider.translate({
    text: `first${BATCH_SEPARATOR}second`,
    sourceLang: 'en',
    targetLang: 'zh'
  });

  assert.equal(result.translated, `translated:first${BATCH_SEPARATOR}translated:second`);
  assert.equal(result.provider, 'codex');
});

test('Codex provider forwards one configured model and task context to every native batch', async () => {
  translationRequests = [];
  responseFactory = request => ({
    version: 2,
    id: request.id,
    ok: true,
    result: {
      translations: request.params.items.map(item => ({ id: item.id, text: `T:${item.text}` }))
    }
  });
  const provider = new CodexTranslate({ model: 'gpt-5-codex' });
  const sourceItems = Array.from({ length: 12 }, (_, index) => `${index}:` + 'x'.repeat(6_998));

  await provider.translate({
    text: sourceItems.join(BATCH_SEPARATOR),
    sourceLang: 'en',
    targetLang: 'zh',
    context: { intent: 'page', contextId: 'page-context-123' }
  });

  assert.ok(translationRequests.length > 1);
  assert.ok(translationRequests.every(request => request.params.model === 'gpt-5-codex'));
  assert.ok(translationRequests.every(request => request.params.sessionId === 'page-context-123'));

  translationRequests = [];
  await new CodexTranslate({ model: '' }).translate({
    text: 'automatic',
    sourceLang: 'en',
    targetLang: 'zh'
  });
  assert.equal(Object.hasOwn(translationRequests[0].params, 'model'), false);
  assert.equal(Object.hasOwn(translationRequests[0].params, 'sessionId'), false);
});

test('Codex provider transparently fragments one over-limit item without splitting a surrogate pair', async () => {
  translationRequests = [];
  responseFactory = request => request.method === 'health'
    ? {
        version: 2,
        id: request.id,
        ok: true,
        result: {
          service: 'ready',
          serviceVersion: '3.2.0',
          protocolVersion: 2,
          securityProfile: 'isolated-chatgpt-v2',
          sdkAvailable: true
        }
      }
    : ({
        version: 2,
        id: request.id,
        ok: true,
        result: {
          translations: [...request.params.items].reverse().map(item => ({ id: item.id, text: item.text }))
        }
      });
  const provider = new CodexTranslate({});
  const source = `${'a'.repeat(7_999)}😀${'b'.repeat(8_001)}`;

  const result = await provider.translate({ text: source, sourceLang: 'en', targetLang: 'zh' });

  assert.equal(result.translated, source);
  assert.equal(translationRequests.length, 1);
  const sent = translationRequests[0].params.items;
  assert.ok(sent.length > 1);
  assert.ok(sent.every(item => item.text.length <= 8_000));
  assert.equal(sent.map(item => item.text).join(''), source);
  assert.ok(sent.every(item => !/[\uD800-\uDBFF]$/.test(item.text)));
  assert.deepEqual(sent.map(item => item.id), sent.map((_, index) => `segment-0-part-${index}`));
});

test('Codex provider never starts a fragment with a detached combining mark', async () => {
  translationRequests = [];
  responseFactory = request => ({
    version: 2,
    id: request.id,
    ok: true,
    result: {
      translations: request.params.items.map(item => ({ id: item.id, text: item.text }))
    }
  });
  const provider = new CodexTranslate({});
  const source = `${'a'.repeat(7_999)}e\u0301${'b'.repeat(200)}`;

  const result = await provider.translate({ text: source, sourceLang: 'en', targetLang: 'zh' });

  assert.equal(result.translated, source);
  const sent = translationRequests[0].params.items;
  assert.equal(sent.map(item => item.text).join(''), source);
  assert.ok(sent.every(item => !/^\p{Mark}/u.test(item.text)));
  assert.ok(sent[0].text.endsWith('a'));
  assert.ok(sent[1].text.startsWith('e\u0301'));
});

test('Codex provider keeps variation, ZWJ emoji, and flag graphemes intact', async () => {
  responseFactory = request => ({
    version: 2,
    id: request.id,
    ok: true,
    result: {
      translations: request.params.items.map(item => ({ id: item.id, text: item.text }))
    }
  });
  const provider = new CodexTranslate({});
  const cases = [
    `${'a'.repeat(7_999)}❤️tail`,
    `${'a'.repeat(7_998)}👩‍💻tail`,
    `${'a'.repeat(7_998)}🇯🇵tail`
  ];

  for (const source of cases) {
    translationRequests = [];
    const result = await provider.translate({ text: source, sourceLang: 'en', targetLang: 'zh' });
    assert.equal(result.translated, source);

    const sent = translationRequests[0].params.items;
    const boundaries = new Set(
      [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(source)]
        .map(segment => segment.index)
    );
    let offset = 0;
    for (const item of sent.slice(0, -1)) {
      offset += item.text.length;
      assert.ok(boundaries.has(offset), `fragment boundary ${offset} must be a grapheme boundary`);
    }
    assert.equal(sent.map(item => item.text).join(''), source);
  }
});

test('Codex fallback keeps a regional-indicator flag intact without Intl.Segmenter', async () => {
  const originalSegmenter = Intl.Segmenter;
  let FallbackCodexTranslate;
  try {
    Intl.Segmenter = undefined;
    ({ CodexTranslate: FallbackCodexTranslate } = await import(
      `../providers/codex.js?fallback-segmenter=${Date.now()}`
    ));
  } finally {
    Intl.Segmenter = originalSegmenter;
  }

  translationRequests = [];
  responseFactory = request => ({
    version: 2,
    id: request.id,
    ok: true,
    result: {
      translations: request.params.items.map(item => ({ id: item.id, text: item.text }))
    }
  });
  const source = `${'a'.repeat(7_998)}🇯🇵tail`;
  const provider = new FallbackCodexTranslate({});
  const result = await provider.translate({ text: source, sourceLang: 'en', targetLang: 'zh' });

  assert.equal(result.translated, source);
  const sent = translationRequests[0].params.items;
  assert.equal(sent.map(item => item.text).join(''), source);
  assert.ok(sent[0].text.endsWith('a'));
  assert.ok(sent[1].text.startsWith('🇯🇵'));
});

test('Codex provider prefers a nearby sentence boundary before the hard item limit', async () => {
  translationRequests = [];
  responseFactory = request => ({
    version: 2,
    id: request.id,
    ok: true,
    result: {
      translations: request.params.items.map(item => ({ id: item.id, text: item.text }))
    }
  });
  const provider = new CodexTranslate({});
  const source = `${'a'.repeat(7_500)}. ${'b'.repeat(1_000)}`;

  const result = await provider.translate({ text: source, sourceLang: 'en', targetLang: 'zh' });

  assert.equal(result.translated, source);
  const sent = translationRequests[0].params.items;
  assert.equal(sent[0].text.length, 7_502);
  assert.ok(sent[0].text.endsWith('. '));
  assert.equal(sent.map(item => item.text).join(''), source);
});

test('Codex provider splits oversized totals into ordered native batches', async () => {
  translationRequests = [];
  responseFactory = request => ({
    version: 2,
    id: request.id,
    ok: true,
    result: {
      translations: [...request.params.items].reverse().map(item => ({ id: item.id, text: `T:${item.text}` }))
    }
  });
  const provider = new CodexTranslate({});
  const sourceItems = Array.from({ length: 12 }, (_, index) => `${index}:` + 'x'.repeat(6_998));

  const result = await provider.translate({
    text: sourceItems.join(BATCH_SEPARATOR),
    sourceLang: 'en',
    targetLang: 'zh'
  });

  assert.equal(result.translated, sourceItems.map(item => `T:${item}`).join(BATCH_SEPARATOR));
  assert.ok(translationRequests.length > 1);
  assert.ok(translationRequests.every(request => request.params.items.length <= 128));
  assert.ok(translationRequests.every(request => (
    request.params.items.reduce((total, item) => total + item.text.length, 0) <= 64_000
  )));
  const shortSessionIds = new Set(translationRequests.map(request => request.params.sessionId));
  assert.equal(shortSessionIds.size, 1);
  assert.match([...shortSessionIds][0], /^short-context-/);
  assert.deepEqual(
    translationRequests.flatMap(request => request.params.items.map(item => item.id)),
    sourceItems.map((_, index) => `segment-${index}`)
  );
});

test('Codex provider preserves order and cardinality across the 128-item request boundary', async () => {
  translationRequests = [];
  responseFactory = request => ({
    version: 2,
    id: request.id,
    ok: true,
    result: {
      translations: [...request.params.items].reverse().map(item => ({ id: item.id, text: `T:${item.text}` }))
    }
  });
  const provider = new CodexTranslate({});
  const sourceItems = Array.from({ length: 130 }, (_, index) => `item-${index}`);

  const result = await provider.translate({
    text: sourceItems.join(BATCH_SEPARATOR),
    sourceLang: 'en',
    targetLang: 'zh'
  });

  assert.equal(result.translated, sourceItems.map(item => `T:${item}`).join(BATCH_SEPARATOR));
  assert.deepEqual(translationRequests.map(request => request.params.items.length), [128, 2]);
  assert.deepEqual(
    translationRequests.flatMap(request => request.params.items.map(item => item.id)),
    sourceItems.map((_, index) => `segment-${index}`)
  );
});

test('Codex provider preserves empty separator slots locally without changing cardinality', async () => {
  translationRequests = [];
  responseFactory = request => ({
    version: 2,
    id: request.id,
    ok: true,
    result: {
      translations: request.params.items.map(item => ({ id: item.id, text: item.text.toUpperCase() }))
    }
  });
  const provider = new CodexTranslate({});

  const result = await provider.translate({
    text: `first${BATCH_SEPARATOR}${BATCH_SEPARATOR}  ${BATCH_SEPARATOR}last`,
    sourceLang: 'en',
    targetLang: 'zh'
  });

  assert.equal(result.translated, `FIRST${BATCH_SEPARATOR}${BATCH_SEPARATOR}  ${BATCH_SEPARATOR}LAST`);
  assert.deepEqual(
    translationRequests.flatMap(request => request.params.items.map(item => item.id)),
    ['segment-0', 'segment-3']
  );
});

test('Codex provider rejects incomplete native batches', async () => {
  translationRequests = [];
  responseFactory = request => ({
    version: 2,
    id: request.id,
    ok: true,
    result: { translations: [{ id: 'segment-0', text: 'only one' }] }
  });
  const provider = new CodexTranslate({});

  await assert.rejects(
    provider.translate({ text: `first${BATCH_SEPARATOR}second`, sourceLang: 'en', targetLang: 'zh' }),
    error => error.code === 'CODEX_INVALID_BATCH' && error.retryable === true
  );
});

test('Codex provider rejects duplicate or unknown response IDs without returning a partial result', async () => {
  translationRequests = [];
  responseFactory = request => ({
    version: 2,
    id: request.id,
    ok: true,
    result: {
      translations: request.params.items.map((item, index) => ({
        id: index === request.params.items.length - 1 ? request.params.items[0].id : item.id,
        text: `translated:${item.text}`
      }))
    }
  });
  const provider = new CodexTranslate({});

  await assert.rejects(
    provider.translate({ text: `first${BATCH_SEPARATOR}second`, sourceLang: 'en', targetLang: 'zh' }),
    error => error.code === 'CODEX_INVALID_BATCH' && /complete translation batch/i.test(error.message)
  );
});

test('Codex provider fails fast on an incompatible companion protocol', async () => {
  translationRequests = [];
  responseFactory = request => ({ version: 3, id: request.id, ok: true, result: {} });
  const provider = new CodexTranslate({});

  await assert.rejects(
    provider.translate({ text: 'hello', sourceLang: 'en', targetLang: 'zh' }),
    error => error.code === 'CODEX_PROTOCOL_MISMATCH' && error.retryable === false
  );
});
