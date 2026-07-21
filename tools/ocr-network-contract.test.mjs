import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  OCR_LANGUAGE_DATA_BASE_URL,
  acquireOcrTask,
  createOcrEngine,
  discardCancelledOcrTask,
  resolveTesseractModule,
  createTesseractWorkerOptions
} from '../ocr/tesseract.js';

const CDN_PERMISSION = 'https://cdn.jsdelivr.net/*';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

test('Tesseract worker uses bundled runtime code without overriding its versioned language path', () => {
  const api = { runtime: { getURL: path => `extension://${path}` } };
  const options = createTesseractWorkerOptions(api);

  assert.equal(options.workerPath, 'extension://vendor/worker.min.js');
  assert.equal(options.corePath, 'extension://vendor/tesseract-core.wasm.js');
  assert.equal(Object.hasOwn(options, 'langPath'), false);
  assert.equal(OCR_LANGUAGE_DATA_BASE_URL, 'https://cdn.jsdelivr.net/npm/@tesseract.js-data');
});

test('bundled worker contains the version-matched jsDelivr language-data fallback', async () => {
  const workerSource = await readFile(new URL('../vendor/worker.min.js', import.meta.url), 'utf8');
  assert.match(workerSource, /https:\/\/cdn\.jsdelivr\.net\/npm\/@tesseract\.js-data\//);
});

test('UMD loader resolves the global Tesseract API and rejects a missing runtime', () => {
  const globalApi = { createWorker() {} };
  assert.strictEqual(resolveTesseractModule({}, { Tesseract: globalApi }), globalApi);
  assert.throws(() => resolveTesseractModule({}, {}), /createWorker/);
});

test('OCR engine uses the Tesseract v5 createWorker signature and replaces workers by language', async () => {
  const calls = [];
  const terminated = [];
  const api = { runtime: { getURL: path => `extension://${path}` } };
  const Tesseract = {
    async createWorker(...args) {
      calls.push(args);
      const language = args[0];
      return {
        async recognize() {
          return { data: { text: language, words: [] } };
        },
        async terminate() {
          terminated.push(language);
        }
      };
    }
  };
  const engine = createOcrEngine({ api, loadTesseract: async () => Tesseract });

  assert.equal((await engine.recognize(new Blob(), ['eng'])).text, 'eng');
  assert.equal((await engine.recognize(new Blob(), ['eng'])).text, 'eng');
  assert.equal(calls.length, 1, 'same language should reuse its worker');
  assert.equal((await engine.recognize(new Blob(), ['fra'])).text, 'fra');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => call.slice(0, 2)), [['eng', 1], ['fra', 1]]);
  assert.equal(calls[0][2].workerPath, 'extension://vendor/worker.min.js');
  assert.deepEqual(terminated, ['eng']);

  await engine.terminate();
  assert.deepEqual(terminated, ['eng', 'fra']);
});

test('queued OCR cancellation skips the worker while started OCR completes normally', async () => {
  const calls = [];
  const gates = new Map([
    ['first', deferred()],
    ['active', deferred()]
  ]);
  const worker = {
    async recognize(blob) {
      calls.push(blob);
      await gates.get(blob).promise;
      return { data: { text: blob, words: [] } };
    },
    async terminate() {}
  };
  const engine = createOcrEngine({
    api: { runtime: { getURL: path => `extension://${path}` } },
    loadTesseract: async () => ({ createWorker: async () => worker })
  });

  const first = engine.recognize('first', ['eng']);
  await nextTurn();
  assert.deepEqual(calls, ['first']);

  const queuedController = new AbortController();
  const skipped = engine.recognize('skipped', ['eng'], queuedController.signal);
  queuedController.abort();
  await assert.rejects(skipped, error => error?.name === 'AbortError');
  assert.deepEqual(calls, ['first'], 'an aborted queued task must not consume the worker');

  gates.get('first').resolve();
  assert.equal((await first).text, 'first');
  await nextTurn();
  assert.deepEqual(calls, ['first']);

  const activeController = new AbortController();
  const active = engine.recognize('active', ['eng'], activeController.signal);
  await nextTurn();
  assert.deepEqual(calls, ['first', 'active']);
  activeController.abort();

  let activeSettled = false;
  void active.then(() => { activeSettled = true; }, () => { activeSettled = true; });
  await nextTurn();
  assert.equal(activeSettled, false, 'Tesseract is not interruptible after recognition starts');

  gates.get('active').resolve();
  assert.equal((await active).text, 'active');
  await engine.terminate();
});

test('a page reuses started OCR across leave/re-entry and drops only cancelled queued work', async () => {
  const calls = [];
  const gates = new Map([
    ['blocker', deferred()],
    ['page-new', deferred()]
  ]);
  const worker = {
    async recognize(blob) {
      calls.push(blob);
      await gates.get(blob)?.promise;
      return { data: { text: blob, words: [] } };
    },
    async terminate() {}
  };
  const engine = createOcrEngine({
    api: { runtime: { getURL: path => `extension://${path}` } },
    loadTesseract: async () => ({ createWorker: async () => worker })
  });
  const state = {
    ocrCache: [{ text: 'cached', bbox: [0, 0, 1, 1] }],
    translationCache: { key: 'kept' }
  };
  const blocker = engine.recognize('blocker', ['eng']);
  await nextTurn();
  assert.deepEqual(calls, ['blocker']);

  const owner = new AbortController();
  let starts = 0;
  const first = acquireOcrTask(state, owner.signal, onStart => {
    starts += 1;
    return engine.recognize('page-old', ['eng'], owner.signal, { onStart });
  });
  const duplicate = acquireOcrTask(state, new AbortController().signal, () => {
    starts += 1;
    return Promise.resolve('duplicate');
  });
  assert.strictEqual(duplicate, first);
  assert.equal(starts, 1);

  owner.abort();
  discardCancelledOcrTask(state);
  assert.equal(state.ocrTask, null, 'the queued owner releases its page reference immediately');
  await assert.rejects(first.promise, error => error?.name === 'AbortError');

  const reentryController = new AbortController();
  const reentered = acquireOcrTask(state, reentryController.signal, onStart => {
    starts += 1;
    return engine.recognize('page-new', ['eng'], reentryController.signal, { onStart }).then(result => {
      state.ocrCache = [{ text: result.text, bbox: [0, 0, 1, 1] }];
      return result.text;
    });
  });
  assert.notStrictEqual(reentered, first);

  gates.get('blocker').resolve();
  await blocker;
  await nextTurn();
  assert.deepEqual(calls, ['blocker', 'page-new'], 'the cancelled page-old task never reaches Tesseract');
  assert.equal(starts, 2);

  reentryController.abort();
  discardCancelledOcrTask(state);
  const startedReentry = acquireOcrTask(state, new AbortController().signal, () => {
    starts += 1;
    return Promise.resolve('duplicate');
  });
  assert.strictEqual(startedReentry, reentered, 'started OCR remains reusable after its render aborts');
  assert.equal(starts, 2);

  gates.get('page-new').resolve();
  assert.equal(await startedReentry.promise, 'page-new');
  await Promise.resolve();
  assert.equal(state.ocrTask, null);
  assert.equal(state.ocrCache[0].text, 'page-new');
  assert.equal(state.translationCache.key, 'kept');
  await engine.terminate();
});

for (const filename of ['manifest.json', 'manifest.chrome.json', 'manifest.firefox.json']) {
  test(`${filename} declares the OCR language-data host`, async () => {
    const url = new URL(`../${filename}`, import.meta.url);
    const manifest = JSON.parse(await readFile(url, 'utf8'));

    assert.ok(manifest.host_permissions.includes(CDN_PERMISSION));
  });
}
