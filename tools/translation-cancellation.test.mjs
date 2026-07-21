import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import {
  TranslationRequestRegistry,
  translationRequestOwner
} from '../core/translationRequests.js';
import { sendCancellableTranslation } from '../core/translationRpc.js';

test('translation request registry enforces sender ownership and keeps legacy messages compatible', () => {
  const registry = new TranslationRequestRegistry();
  const firstOwner = translationRequestOwner({
    id: 'extension-id',
    tab: { id: 7 },
    frameId: 0,
    documentId: 'document-a'
  });
  const otherOwner = translationRequestOwner({
    id: 'extension-id',
    tab: { id: 7 },
    frameId: 0,
    documentId: 'document-b'
  });
  const ticket = registry.start('page-request-1', firstOwner);

  assert.equal(registry.cancel('page-request-1', otherOwner), false);
  assert.equal(ticket.controller.signal.aborted, false);
  assert.equal(registry.cancel('page-request-1', firstOwner), true);
  assert.equal(ticket.controller.signal.aborted, true);
  assert.equal(ticket.controller.signal.reason?.code, 'TRANSLATION_CANCELLED');

  const legacy = registry.start(undefined, firstOwner);
  assert.equal(legacy.requestId, null);
  assert.equal(registry.cancel('unrelated-request', firstOwner), false);
  registry.finish(legacy);

  assert.equal(registry.cancel('future-request', firstOwner), false);
  const future = registry.start('future-request', firstOwner);
  assert.equal(future.controller.signal.aborted, false);
  registry.finish(future);
});

test('cancellable translation RPC correlates abort with a background cancel message', async () => {
  const messages = [];
  let resolveTranslation;
  const runtimeApi = {
    runtime: {
      sendMessage(message) {
        messages.push(message);
        if (message.action === 'cancelTranslation') {
          return Promise.resolve({ ok: true, cancelled: true });
        }
        return new Promise(resolve => { resolveTranslation = resolve; });
      }
    }
  };
  const controller = new AbortController();
  const pending = sendCancellableTranslation({ text: 'hello' }, {
    signal: controller.signal,
    prefix: 'unit',
    runtimeApi
  });
  controller.abort();

  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(messages[0].action, 'translateText');
  assert.equal(messages[1].action, 'cancelTranslation');
  assert.equal(messages[1].requestId, messages[0].requestId);

  // A late background response is observed by the RPC's attached handler and
  // cannot become an unhandled rejection or revive the cancelled caller.
  resolveTranslation({ ok: false, code: 'TRANSLATION_CANCELLED' });
});

test('cancellable translation RPC converts synchronous messaging failures to rejections', async () => {
  const pending = sendCancellableTranslation({ text: 'hello' }, {
    runtimeApi: {
      runtime: {
        sendMessage() { throw new Error('extension context closed'); }
      }
    }
  });
  assert.equal(typeof pending?.then, 'function');
  await assert.rejects(pending, /extension context closed/);
});

test('page, background, router, and remote providers carry the cancellation signal', async () => {
  const files = await Promise.all([
    readFile(new URL('../content/content.js', import.meta.url), 'utf8'),
    readFile(new URL('../background.js', import.meta.url), 'utf8'),
    readFile(new URL('../core/router.js', import.meta.url), 'utf8'),
    readFile(new URL('../providers/openai.js', import.meta.url), 'utf8'),
    readFile(new URL('../providers/gemini.js', import.meta.url), 'utf8'),
    readFile(new URL('../providers/googleTranslate.js', import.meta.url), 'utf8'),
    readFile(new URL('../providers/deepl.js', import.meta.url), 'utf8'),
    readFile(new URL('../providers/azureTranslate.js', import.meta.url), 'utf8')
  ]);
  const [content, background, router, ...providers] = files;

  assert.match(content, /controller\.abort\(error\)/);
  assert.match(content, /sendCancellableTranslation/);
  assert.match(background, /cancelTranslation/);
  assert.match(background, /ticket\.controller\.signal/);
  assert.match(background, /contextId:\s*msg\.contextId/);
  assert.match(router, /const payload = \{[\s\S]*?context:\s*translationContext\(intent, contextId\),[\s\S]*?signal[\s\S]*?\};/);
  assert.match(router, /provider\.translate\(payload\);[\s\S]*?throwIfAborted\(signal\)/);
  providers.forEach(source => assert.match(source, /fetch\([\s\S]*?signal/));
});

test('selection navigation and page BFCache paths fail closed instead of reusing stale DOM', async () => {
  const [content, background] = await Promise.all([
    readFile(new URL('../content/content.js', import.meta.url), 'utf8'),
    readFile(new URL('../background.js', import.meta.url), 'utf8')
  ]);

  assert.match(background, /tabStillAtUrl\(tabId, tabUrl\)/);
  assert.match(background, /tabs\.sendMessage\(tabId, msg, \{ frameId \}\)/);
  assert.doesNotMatch(background, /tabs\.sendMessage\(tabId, msg\);/);
  assert.match(background, /frameIds:\s*\[frameId\]/);
  assert.match(background, /sourceUrl:\s*info\.frameUrl \|\| tabUrl/);
  assert.match(background, /info\.frameUrl \|\| tabUrl,\s*info\.frameId\s*\);/);
  assert.match(background, /menuItemId === 'translate-page'[\s\S]*?\{ action: 'translatePage' \}[\s\S]*?info\.frameId\s*\);/);
  assert.match(background, /menuItemId === 'translate-image'[\s\S]*?\{ action: 'translateImageAtUrl', srcUrl: info\.srcUrl \}[\s\S]*?info\.frameId\s*\);/);
  assert.match(background, /allowInjection:\s*false/);
  assert.match(background, /action:\s*'getSelectionCapture'/);
  assert.match(background, /selectionCaptureId:\s*selectionCapture\.captureId/);
  assert.match(background, /selectionGeneration:\s*selectionCapture\.generation/);
  assert.match(content, /location\.href !== msg\.sourceUrl/);
  assert.match(content, /msg\.sourceText && !r/);
  assert.match(content, /CONTEXT_SELECTION_TTL_MS = 5 \* 60_000/);
  assert.match(content, /captured\.document === document/);
  assert.match(content, /captured\.frame === window/);
  assert.match(content, /captured\.generation === selectionNavigationGeneration/);
  assert.match(content, /captured\.range\.toString\(\)/);
  assert.match(content, /captured\.id !== captureId/);
  assert.doesNotMatch(content, /const currentRange = selection/);
  assert.match(content, /new MutationObserver/);
  assert.match(content, /\['popstate', 'hashchange', 'pageshow', 'pagehide'\]/);
  assert.match(content, /addLifecycleGuard\(globalThis\.navigation, 'navigate'\)/);
  assert.match(content, /clearSelectionCapture\(\);\s*if \(!selectionCaptureMatches/);
  assert.match(content, /invalidateSelectionCapture\(\);\s*if \(!pageTranslationSession\)/);
  assert.match(content, /stopPageTranslation\(pageTranslationSession\.renderer\)/);
});

test('selection capture rejects mutated, detached, replaced, and BFCache-stale ranges', async () => {
  const source = await readFile(new URL('../content/content.js', import.meta.url), 'utf8');
  const selectionSource = source.slice(0, source.indexOf('const TRANSLATION_STYLE_DEFAULTS'));
  const documentListeners = new Map();
  const documentRef = {
    addEventListener(type, listener) { documentListeners.set(type, listener); }
  };
  const locationRef = { href: 'https://frame.example/article' };
  let currentSelection = null;
  function fakeEventTarget(extra = {}) {
    const listeners = new Map();
    return {
      ...extra,
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      emit(type) {
        for (const listener of [...(listeners.get(type) || [])]) listener({ type });
      }
    };
  }
  const windowRef = fakeEventTarget({ getSelection: () => currentSelection });
  const navigationRef = fakeEventTarget();
  const mutationObservers = [];
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      mutationObservers.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    disconnect() { this.disconnected = true; }
    emit(records) {
      if (!this.disconnected) this.callback(records);
    }
  }
  const sandbox = {
    browser: {},
    document: documentRef,
    window: windowRef,
    location: locationRef,
    navigation: navigationRef,
    MutationObserver: FakeMutationObserver,
    Date,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: (() => {
      let nextId = 0;
      return () => `capture-${++nextId}`;
    })() }
  };

  vm.runInNewContext(`${selectionSource}\n;globalThis.selectionHarness = { getSelectionCaptureContext, takeSelectionRange, invalidateSelectionCapture };`, sandbox);
  const harness = sandbox.selectionHarness;
  const onContextMenu = documentListeners.get('contextmenu');
  assert.equal(typeof onContextMenu, 'function');

  function fakeNode({ nodeType = 1, parentNode = null } = {}) {
    const node = {
      nodeType,
      parentNode,
      ownerDocument: documentRef,
      isConnected: true,
      childNodes: [],
      contains(other) {
        for (let current = other; current; current = current.parentNode) {
          if (current === node) return true;
        }
        return false;
      }
    };
    parentNode?.childNodes.push(node);
    return node;
  }
  function rangeState(text) {
    const common = fakeNode();
    const start = fakeNode({ nodeType: 3, parentNode: common });
    return {
      text,
      collapsed: false,
      common,
      start,
      end: start
    };
  }
  function liveRange(state) {
    return {
      get collapsed() { return state.collapsed; },
      get startContainer() { return state.start; },
      get endContainer() { return state.end; },
      get commonAncestorContainer() { return state.common; },
      toString() { return state.text; },
      intersectsNode(node) { return node === state.start; },
      comparePoint(target, offset) {
        return target === state.common && offset === 0 ? 0 : 1;
      },
      cloneRange() { return liveRange(state); }
    };
  }
  function capture(state) {
    const range = liveRange(state);
    currentSelection = {
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => range,
      toString: () => state.text
    };
    onContextMenu();
    return harness.getSelectionCaptureContext(state.text, locationRef.href);
  }

  const valid = rangeState('captured text');
  const validContext = capture(valid);
  const validObserver = mutationObservers.at(-1);
  assert.equal(
    harness.takeSelectionRange(
      'captured text',
      locationRef.href,
      validContext.captureId,
      validContext.generation
    )?.toString(),
    'captured text'
  );
  assert.equal(validObserver.disconnected, true, 'consuming a capture disconnects its observer');

  const mutated = rangeState('captured text');
  const mutatedContext = capture(mutated);
  mutated.text = 'changed after translation started';
  assert.equal(harness.takeSelectionRange(
    'captured text',
    locationRef.href,
    mutatedContext.captureId,
    mutatedContext.generation
  ), null);

  const detached = rangeState('captured text');
  const detachedContext = capture(detached);
  detached.start.isConnected = false;
  assert.equal(harness.takeSelectionRange(
    'captured text',
    locationRef.href,
    detachedContext.captureId,
    detachedContext.generation
  ), null);

  const collapsed = rangeState('captured text');
  const collapsedContext = capture(collapsed);
  collapsed.collapsed = true;
  assert.equal(harness.takeSelectionRange(
    'captured text',
    locationRef.href,
    collapsedContext.captureId,
    collapsedContext.generation
  ), null);

  const wrongGeneration = rangeState('captured text');
  const wrongGenerationContext = capture(wrongGeneration);
  assert.equal(harness.takeSelectionRange(
    'captured text',
    locationRef.href,
    wrongGenerationContext.captureId,
    wrongGenerationContext.generation + 1
  ), null);

  const original = rangeState('captured text');
  const originalContext = capture(original);
  const originalObserver = mutationObservers.at(-1);
  const replacement = rangeState('captured text');
  const replacementContext = capture(replacement);
  assert.equal(originalObserver.disconnected, true, 'a new context disconnects the previous observer');
  assert.equal(harness.takeSelectionRange(
    'captured text',
    locationRef.href,
    originalContext.captureId,
    originalContext.generation
  ), null);
  assert.equal(
    harness.takeSelectionRange(
      'captured text',
      locationRef.href,
      replacementContext.captureId,
      replacementContext.generation
    )?.toString(),
    'captured text',
    'a late result must not consume the newer capture'
  );

  const stale = rangeState('captured text');
  const staleContext = capture(stale);
  harness.invalidateSelectionCapture();
  assert.equal(harness.takeSelectionRange(
    'captured text',
    locationRef.href,
    staleContext.captureId,
    staleContext.generation
  ), null);

  const navigated = rangeState('captured text');
  const navigatedContext = capture(navigated);
  locationRef.href = 'https://frame.example/next';
  assert.equal(harness.takeSelectionRange(
    'captured text',
    'https://frame.example/article',
    navigatedContext.captureId,
    navigatedContext.generation
  ), null);

  locationRef.href = 'https://frame.example/article';
  const restoredUrl = rangeState('captured text');
  const restoredUrlContext = capture(restoredUrl);
  locationRef.href = 'https://frame.example/away';
  windowRef.emit('popstate');
  locationRef.href = 'https://frame.example/article';
  assert.equal(harness.takeSelectionRange(
    'captured text',
    locationRef.href,
    restoredUrlContext.captureId,
    restoredUrlContext.generation
  ), null, 'away/back to the same URL remains stale');

  const navigationApiState = rangeState('captured text');
  const navigationApiContext = capture(navigationApiState);
  navigationRef.emit('navigate');
  assert.equal(harness.takeSelectionRange(
    'captured text',
    locationRef.href,
    navigationApiContext.captureId,
    navigationApiContext.generation
  ), null, 'Navigation API events invalidate push/replace/traverse captures');

  const restoredText = rangeState('captured text');
  const restoredTextContext = capture(restoredText);
  const restoredTextObserver = mutationObservers.at(-1);
  restoredText.text = 'temporary change';
  restoredText.text = 'captured text';
  restoredTextObserver.emit([{
    type: 'characterData',
    target: restoredText.start
  }]);
  assert.equal(harness.takeSelectionRange(
    'captured text',
    locationRef.href,
    restoredTextContext.captureId,
    restoredTextContext.generation
  ), null, 'a relevant mutation remains stale even if text is restored before delivery');

  const unrelatedMutation = rangeState('captured text');
  const unrelatedContext = capture(unrelatedMutation);
  const unrelatedObserver = mutationObservers.at(-1);
  const unrelatedSibling = fakeNode({ parentNode: unrelatedMutation.common });
  unrelatedObserver.emit([{
    type: 'childList',
    target: unrelatedMutation.common,
    addedNodes: [unrelatedSibling],
    removedNodes: [],
    previousSibling: unrelatedMutation.start,
    nextSibling: null
  }]);
  assert.equal(
    harness.takeSelectionRange(
      'captured text',
      locationRef.href,
      unrelatedContext.captureId,
      unrelatedContext.generation
    )?.toString(),
    'captured text',
    'an unrelated mutation after the selected range must not invalidate it'
  );
});

test('static content scripts capture context menus in supported inherited-origin frames', async () => {
  for (const filename of ['manifest.json', 'manifest.chrome.json', 'manifest.firefox.json']) {
    const manifest = JSON.parse(await readFile(new URL(`../${filename}`, import.meta.url), 'utf8'));
    const contentScript = manifest.content_scripts?.find(entry => entry.js?.includes('content/content.js'));
    assert.ok(contentScript, `${filename} must register content/content.js statically`);
    assert.equal(contentScript.all_frames, true, `${filename} must capture iframe context menus at load time`);
    assert.equal(contentScript.match_about_blank, true, `${filename} must cover inherited about:blank frames`);
    assert.equal(
      contentScript.match_origin_as_fallback,
      filename === 'manifest.firefox.json' ? undefined : true,
      `${filename} must use its platform-specific inherited-origin matching contract`
    );
    assert.equal(manifest.permissions?.includes('webNavigation'), false, `${filename} must not add webNavigation`);
  }
});
