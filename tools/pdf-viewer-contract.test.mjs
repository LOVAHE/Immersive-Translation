import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  chunkPdfParagraphs,
  groupPdfTextItems,
  isUsablePdfText,
  layoutPdfTranslationParagraphs,
  textItemToViewportRect
} from '../pdf/layout.js';
import {
  activatePdfPageState,
  deactivatePdfPageState,
  disposePdfPageState
} from '../pdf/pageLifecycle.js';
import { expiredPdfRequestKeys, PDF_REQUEST_PREFIX } from '../core/pdfHandoff.js';
import { sendCancellableTranslation } from '../core/translationRpc.js';
import { readPdfResponse } from '../pdf/source.js';

test('PDF text rectangles follow the full viewport transform, including rotation', () => {
  const item = { text: 'hello', transform: [10, 0, 0, 10, 20, 30], width: 40, height: 10 };

  assert.deepEqual(
    textItemToViewportRect(item, { transform: [1, 0, 0, -1, 0, 100], scale: 1 }),
    [20, 60, 60, 70]
  );
  assert.deepEqual(
    textItemToViewportRect(item, { transform: [0, 1, 1, 0, 0, 0], scale: 1 }),
    [30, 20, 40, 60]
  );
});

test('same-height text in separate PDF columns never becomes one paragraph', () => {
  const items = [
    { text: 'Left one', bbox: [10, 10, 70, 22] },
    { text: 'Right one', bbox: [310, 10, 380, 22] },
    { text: 'Left two', bbox: [10, 24, 70, 36] },
    { text: 'Right two', bbox: [310, 24, 380, 36] }
  ];

  const paragraphs = groupPdfTextItems(items);
  assert.ok(paragraphs.some(paragraph => paragraph.text.includes('Left one')));
  assert.ok(paragraphs.some(paragraph => paragraph.text.includes('Right one')));
  assert.ok(paragraphs.some(paragraph => paragraph.text.includes('Left one') && paragraph.text.includes('Left two')));
  assert.ok(paragraphs.some(paragraph => paragraph.text.includes('Right one') && paragraph.text.includes('Right two')));
  assert.ok(paragraphs.every(paragraph => !(paragraph.text.includes('Left') && paragraph.text.includes('Right'))));
});

test('PDF translation chunks preserve order and enforce item and character bounds', () => {
  const paragraphs = Array.from({ length: 7 }, (_, index) => ({
    id: `p-${index}`,
    text: `paragraph-${index}`,
    bbox: [0, index * 10, 100, index * 10 + 8]
  }));

  const chunks = chunkPdfParagraphs(paragraphs, { maxItems: 3, maxChars: 30 });
  assert.deepEqual(chunks.flat().map(item => item.id), paragraphs.map(item => item.id));
  assert.ok(chunks.every(chunk => chunk.length <= 3));
  assert.ok(chunks.every(chunk => chunk.reduce((sum, item) => sum + item.text.length, 0) <= 30));
  assert.throws(
    () => chunkPdfParagraphs([{ id: 'too-long', text: 'x'.repeat(31) }], { maxItems: 3, maxChars: 30 }),
    /exceeds the 30-character/i
  );
});

test('translated PDF paragraphs reserve non-overlapping regions in each column', () => {
  const paragraphs = [
    { id: 'left-top', text: 'A', bbox: [10, 10, 150, 24] },
    { id: 'right-middle', text: 'B', bbox: [230, 25, 380, 39] },
    { id: 'left-next', text: 'C', bbox: [12, 42, 148, 56] }
  ];
  const regions = layoutPdfTranslationParagraphs(paragraphs, {
    pageWidth: 400,
    pageHeight: 600,
    gap: 2
  });
  const top = regions.find(region => region.paragraph.id === 'left-top');
  const next = regions.find(region => region.paragraph.id === 'left-next');

  assert.ok(top.y + top.maxHeight <= next.y - 2);
  assert.ok(top.maxHeight > top.sourceHeight, 'the translation may grow into column whitespace');
  assert.ok(regions.find(region => region.paragraph.id === 'right-middle').maxHeight > 100,
    'another column does not constrain the left column');
});

test('PDF response streaming enforces the byte limit without Content-Length', async () => {
  let cancelled = 0;
  const chunks = [new TextEncoder().encode('%PDF-'), new Uint8Array([1, 2, 3, 4])];
  const response = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          async read() { return chunks.length ? { done: false, value: chunks.shift() } : { done: true }; },
          async cancel() { cancelled += 1; },
          releaseLock() {}
        };
      }
    }
  };

  await assert.rejects(readPdfResponse(response, { maxBytes: 8 }), /larger than/i);
  assert.equal(cancelled, 1);
});

test('PDF response streaming returns a valid PDF and honors AbortSignal', async () => {
  const validChunks = [new TextEncoder().encode('%P'), new TextEncoder().encode('DF-body')];
  const valid = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: { getReader: () => ({
      async read() { return validChunks.length ? { done: false, value: validChunks.shift() } : { done: true }; },
      async cancel() {},
      releaseLock() {}
    }) }
  };
  const bytes = new Uint8Array(await readPdfResponse(valid, { maxBytes: 64 }));
  assert.equal(new TextDecoder().decode(bytes), '%PDF-body');

  const controller = new AbortController();
  let finishRead;
  let cancelled = 0;
  const waiting = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: { getReader: () => ({
      read() { return new Promise(resolve => { finishRead = resolve; }); },
      async cancel() { cancelled += 1; finishRead?.({ done: true }); },
      releaseLock() {}
    }) }
  };
  const pending = readPdfResponse(waiting, { maxBytes: 64, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error?.name === 'AbortError');
  assert.equal(cancelled, 1);
});

test('an aborted PDF translation sends the shared cancellation RPC', async () => {
  const messages = [];
  const runtimeApi = {
    runtime: {
      sendMessage(message) {
        messages.push(message);
        if (message.action === 'cancelTranslation') return Promise.resolve({ ok: true, cancelled: true });
        return new Promise(() => {});
      }
    }
  };
  const controller = new AbortController();
  const pending = sendCancellableTranslation({ text: 'PDF paragraph', intent: 'pdf' }, {
    signal: controller.signal,
    prefix: 'pdf-page',
    runtimeApi
  });
  controller.abort();
  await assert.rejects(pending, error => error?.name === 'AbortError');
  await Promise.resolve();

  assert.equal(messages[0].action, 'translateText');
  assert.equal(messages[1].action, 'cancelTranslation');
  assert.equal(messages[1].requestId, messages[0].requestId);
});

test('expired local PDF handoffs are identifiable without touching unrelated storage', () => {
  const now = 1_000_000;
  const keys = expiredPdfRequestKeys({
    [`${PDF_REQUEST_PREFIX}fresh-request-1234`]: { src: 'https://example.com/fresh.pdf', createdAt: now - 1000 },
    [`${PDF_REQUEST_PREFIX}expired-request`]: { src: 'https://example.com/old.pdf', createdAt: 1 },
    [`${PDF_REQUEST_PREFIX}broken-request`]: { src: '', createdAt: now },
    unrelated: { createdAt: 1 }
  }, now);
  assert.deepEqual(keys.sort(), [
    `${PDF_REQUEST_PREFIX}broken-request`,
    `${PDF_REQUEST_PREFIX}expired-request`
  ]);
});

test('a token-sized or mostly broken PDF text layer falls back to OCR', () => {
  assert.equal(isUsablePdfText([{ text: '1', bbox: [0, 0, 5, 5] }]), false);
  assert.equal(isUsablePdfText([{ text: '\ufffd\ufffd\ufffd', bbox: [0, 0, 5, 5] }]), false);
  assert.equal(isUsablePdfText([
    { text: 'A meaningful paragraph with enough selectable text.', bbox: [0, 0, 200, 20] },
    { text: 'A second line confirms that this is a text PDF.', bbox: [0, 22, 200, 42] }
  ]), true);
});

test('PDF viewer is lazy, selectable, bilingual, and does not use translation cards', async () => {
  const [html, viewer, extractor, css] = await Promise.all([
    readFile(new URL('../pages/pdf_viewer.html', import.meta.url), 'utf8'),
    readFile(new URL('../pages/pdf_viewer.js', import.meta.url), 'utf8'),
    readFile(new URL('../pdf/extract.js', import.meta.url), 'utf8'),
    readFile(new URL('../pages/pdf_viewer.css', import.meta.url), 'utf8')
  ]);

  assert.match(html, /id="pdf-toolbar"/);
  assert.match(html, /id="pdf-mode"/);
  assert.match(viewer, /new IntersectionObserver/);
  assert.match(viewer, /const placeholderInfo = await pdfDocument\.getPageInfo\(1, scale\)/);
  assert.doesNotMatch(viewer, /getPageInfo\(state\.pageNumber, requestedScale\)/);
  assert.match(viewer, /pageGeneration !== state\.generation/);
  assert.match(viewer, /state\.translationCache/);
  assert.match(viewer, /acquireOcrTask\(state, signal/);
  assert.match(viewer, /ocrEngine\.recognize\(blob, languages, signal/);
  assert.match(viewer, /discardCancelledOcrTask\(state\)/);
  assert.match(viewer, /layoutPdfTranslationParagraphs/);
  assert.match(viewer, /sendCancellableTranslation/);
  assert.match(viewer, /createTranslationRequestId\('pdf-context'\)/);
  assert.match(viewer, /intent:\s*'pdf',[\s\S]*?contextId:\s*translationContextId/);
  assert.match(viewer, /closeTranslationContext\(previousTranslationContextId\)/);
  assert.match(viewer, /readPdfResponse/);
  assert.doesNotMatch(viewer, /response\.arrayBuffer\(\)/);
  assert.match(viewer, /retryDocumentButton\.addEventListener\('click', \(\) => start\(\)\)/);
  assert.doesNotMatch(viewer, /retryDocumentButton\.addEventListener\('click', \(\) => location\.reload\(\)\)/);
  assert.match(viewer, /text-layer/);
  assert.match(viewer, /translation-page/);
  assert.match(extractor, /openPdfDocument/);
  assert.match(extractor, /streamTextContent/);
  assert.doesNotMatch(viewer, /URL\.createObjectURL/);
  assert.doesNotMatch(html, /tl-bubble|box-shadow:\s*0 4px 16px/);
  assert.doesNotMatch(css, /\.translated-paragraph:focus\s*\{[^}]*overflow:\s*visible/s);
});

test('PDF BFCache suspension closes the old context and resumes visible pages with a new context', async () => {
  const viewer = await readFile(new URL('../pages/pdf_viewer.js', import.meta.url), 'utf8');

  assert.match(viewer, /function suspendPdfForBfCache\(\)[\s\S]*?documentGeneration \+= 1;[\s\S]*?deactivatePdfPageState\(state\)[\s\S]*?closeCurrentPdfTranslationContext\(\)/);
  assert.match(viewer, /const openedDocument = await openPdfDocument[\s\S]*?if \(signal\.aborted\)[\s\S]*?openedDocument\.destroy\(\)/);
  assert.match(viewer, /const startGeneration = \+\+documentGeneration[\s\S]*?await previousDocument\.destroy\(\)[\s\S]*?documentGeneration !== startGeneration/);
  assert.match(viewer, /function resumePdfFromBfCache\(\)[\s\S]*?!states\.length[\s\S]*?createTranslationRequestId\('pdf-context'\)[\s\S]*?scheduleVisiblePages\(\)/);
  assert.match(viewer, /function schedulePage\(state\) \{\s*if \(pdfBfCacheSuspended \|\| !pdfDocument/);
  assert.match(viewer, /addEventListener\('pagehide', event => \{\s*if \(event\.persisted\) suspendPdfForBfCache\(\)/);
  assert.match(viewer, /addEventListener\('pageshow', event => \{\s*if \(event\.persisted\) resumePdfFromBfCache\(\)/);
});

test('PDF URLs use an ephemeral handoff and optional origin permission', async () => {
  const [background, chromeManifest, firefoxManifest] = await Promise.all([
    readFile(new URL('../background.js', import.meta.url), 'utf8'),
    readFile(new URL('../manifest.chrome.json', import.meta.url), 'utf8'),
    readFile(new URL('../manifest.firefox.json', import.meta.url), 'utf8')
  ]);

  assert.match(background, /permissions\.request/);
  assert.match(background, /pdfRequest:/);
  assert.match(background, /removePdfRequest\(requestId\)/);
  assert.doesNotMatch(background, /pdf_viewer\.html'\) \+ '\?src='/);
  assert.deepEqual(JSON.parse(chromeManifest).optional_host_permissions, ['http://*/*', 'https://*/*', 'file:///*']);
  assert.deepEqual(JSON.parse(firefoxManifest).optional_host_permissions, ['http://*/*', 'https://*/*', 'file:///*']);
});

test('offscreen PDF pages release heavy state and can be scheduled again', () => {
  let aborted = 0;
  let released = 0;
  let scheduled = 0;
  const layer = () => ({ children: ['heavy'], replaceChildren() { this.children = []; } });
  const state = {
    pageNumber: 4,
    generation: 2,
    status: 'ready',
    controller: { abort() { aborted += 1; } },
    sourceCanvas: { width: 1600, height: 2200 },
    targetCanvas: { width: 1600, height: 2200 },
    textLayer: layer(),
    translationLayer: layer(),
    message: { ...layer(), dataset: { visible: 'true' } },
    translationCache: { key: 'kept' },
    ocrCache: [{ text: 'kept', bbox: [0, 0, 1, 1] }],
    disposeTimer: null
  };

  disposePdfPageState(state, pageNumber => { released = pageNumber; });
  assert.equal(aborted, 1);
  assert.equal(released, 4);
  assert.equal(state.status, 'idle');
  assert.equal(state.sourceCanvas.width, 1);
  assert.equal(state.targetCanvas.height, 1);
  assert.deepEqual(state.textLayer.children, []);
  assert.equal(state.translationCache.key, 'kept');
  assert.equal(state.ocrCache[0].text, 'kept');

  activatePdfPageState(state, () => { scheduled += 1; });
  assert.equal(scheduled, 1);
});

test('leaving the PDF observer margin immediately cancels costly page work', () => {
  let aborted = 0;
  const state = {
    generation: 4,
    status: 'translating',
    controller: { abort() { aborted += 1; } }
  };
  deactivatePdfPageState(state);
  assert.equal(aborted, 1);
  assert.equal(state.generation, 5);
  assert.equal(state.status, 'idle');
  assert.equal(state.controller, null);
});

test('PDF reader chrome is localized in every supported UI language', async () => {
  const html = await readFile(new URL('../pages/pdf_viewer.html', import.meta.url), 'utf8');
  const keys = new Set(Array.from(
    html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g),
    match => match[1]
  ));
  for (const locale of ['de', 'en', 'es', 'fr', 'ja', 'ko', 'zh']) {
    const messages = JSON.parse(await readFile(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'));
    for (const key of keys) assert.ok(messages[key]?.message, `${locale} is missing ${key}`);
  }
});
