import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  YouTubeOverlayController,
  cueStateAtTime
} from '../content/youtube.js';

class ListenerSet {
  listeners = new Set();
  addListener(listener) { this.listeners.add(listener); }
  removeListener(listener) { this.listeners.delete(listener); }
  emit(...args) { for (const listener of [...this.listeners]) listener(...args); }
}

class FakeWindow {
  constructor(pathname = '/watch', search = '?v=A') {
    this.location = { hostname: 'www.youtube.com', pathname, search };
    this.listeners = new Map();
  }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  emit(name, ...args) {
    for (const listener of [...(this.listeners.get(name) || [])]) listener(...args);
  }
  listenerCount(name) { return this.listeners.get(name)?.size || 0; }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class TestController extends YouTubeOverlayController {
  constructor(options) {
    super(options);
    this.loads = [];
    this.pendingLoads = new Map();
    this.activations = [];
    this.unmounts = 0;
  }
  async loadCurrentVideo({ signal, generation }) {
    const videoId = new URLSearchParams(this.window.location.search).get('v');
    const pending = deferred();
    this.pendingLoads.set(videoId, pending);
    this.loads.push({ videoId, signal, generation });
    return pending.promise;
  }
  mountOverlay() { this.overlay = { remove() {} }; }
  unmountOverlay() {
    this.unmounts += 1;
    this.overlay = null;
    this.currentCues = [];
    this.lastCueIndex = -1;
  }
  startTicker(video) { this.activations.push(video.id); }
}

test('singleton-style start is idempotent and rapid A-to-B navigation rejects stale activation', async () => {
  const windowRef = new FakeWindow();
  const storageChanges = new ListenerSet();
  let enabled = true;
  const controller = new TestController({
    windowRef,
    documentRef: {},
    runtimeApi: { storage: { onChanged: storageChanges } },
    settingsReader: async () => ({
      ytBilingualOverlay: enabled,
      ytPreferBuiltIn: true,
      targetLang: 'zh'
    }),
    navigationDelayMs: 0,
    requestAnimationFrameImpl: () => 1,
    cancelAnimationFrameImpl: () => {}
  });

  const firstTask = controller.start();
  const repeatedStart = controller.start();
  assert.equal(firstTask, repeatedStart);
  assert.equal(windowRef.listenerCount('yt-navigate-finish'), 1);
  assert.equal(storageChanges.listeners.size, 1);
  await Promise.resolve();
  const firstLoad = controller.loads[0];

  windowRef.location.search = '?v=B';
  windowRef.emit('yt-navigate-finish');
  await Promise.resolve();
  const secondTask = controller.currentTask;
  assert.equal(firstLoad.signal.aborted, true);
  assert.equal(controller.loads[1].videoId, 'B');

  controller.pendingLoads.get('B').resolve({
    cues: [{ start: 0, end: 1_000, src: 'B', tgt: '乙' }],
    video: { id: 'B' }
  });
  await secondTask;
  controller.pendingLoads.get('A').resolve({
    cues: [{ start: 0, end: 1_000, src: 'A', tgt: '甲' }],
    video: { id: 'A' }
  });
  await firstTask;
  assert.deepEqual(controller.activations, ['B']);

  enabled = false;
  storageChanges.emit({ ytBilingualOverlay: { newValue: false } }, 'sync');
  await controller.currentTask;
  assert.equal(controller.overlay, null);

  controller.dispose();
  assert.equal(windowRef.listenerCount('yt-navigate-finish'), 0);
  assert.equal(storageChanges.listeners.size, 0);
});

test('late duplicate events for the same video keep one task context and do not restart translation', async () => {
  const windowRef = new FakeWindow('/watch', '?v=stable');
  const controller = new TestController({
    windowRef,
    documentRef: {},
    runtimeApi: { storage: { onChanged: new ListenerSet() } },
    settingsReader: async () => ({ ytBilingualOverlay: true, targetLang: 'zh' }),
    navigationDelayMs: 0,
    requestAnimationFrameImpl: () => 1,
    cancelAnimationFrameImpl: () => {}
  });

  const firstTask = controller.start();
  await Promise.resolve();
  const firstLoad = controller.loads[0];
  const contextId = controller.translationContextId;

  windowRef.emit('yt-page-data-updated');
  await Promise.resolve();
  assert.equal(controller.currentTask, firstTask);
  assert.equal(controller.translationContextId, contextId);
  assert.equal(controller.loads.length, 1);
  assert.equal(firstLoad.signal.aborted, false);

  controller.pendingLoads.get('stable').resolve({
    cues: [{ start: 0, end: 1_000, src: 'stable', tgt: '稳定' }],
    video: { id: 'stable' }
  });
  await firstTask;

  windowRef.emit('yt-page-data-updated');
  await Promise.resolve();
  assert.equal(controller.translationContextId, contextId);
  assert.equal(controller.loads.length, 1);
  assert.deepEqual(controller.activations, ['stable']);
  controller.dispose();
});

test('caption translation waits until the same-video player can own the result', async () => {
  const windowRef = new FakeWindow('/watch', '?v=player-gate');
  const storageChanges = new ListenerSet();
  let video = null;
  let fetches = 0;
  let translations = 0;
  const playerResponse = {
    videoDetails: { videoId: 'player-gate' },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?id=player-gate' }]
      }
    }
  };
  const documentRef = {
    querySelector(selector) {
      if (selector === 'ytd-watch-flexy') return { playerResponse };
      if (selector === 'video.html5-main-video' || selector === 'video') return video;
      return null;
    }
  };
  class PlayerGateController extends YouTubeOverlayController {
    mountOverlay() { this.overlay = { isConnected: true, remove() {} }; }
    startTicker(owner) { this.activatedVideo = owner; }
  }
  const controller = new PlayerGateController({
    windowRef,
    documentRef,
    runtimeApi: { storage: { onChanged: storageChanges } },
    settingsReader: async () => ({
      ytBilingualOverlay: true,
      ytPreferBuiltIn: false,
      targetLang: 'zh'
    }),
    fetchImpl: async () => {
      fetches += 1;
      return {
        ok: true,
        async json() {
          return {
            events: [{ tStartMs: 0, dDurationMs: 1_000, segs: [{ utf8: 'hello' }] }]
          };
        }
      };
    },
    sendTranslation: async () => {
      translations += 1;
      return { ok: true, result: { translated: '你好' } };
    },
    navigationDelayMs: 0,
    requestAnimationFrameImpl: () => 1,
    cancelAnimationFrameImpl: () => {}
  });

  await controller.start();
  const contextId = controller.translationContextId;
  assert.equal(fetches, 0);
  assert.equal(translations, 0);

  video = { id: 'player-gate', isConnected: true };
  windowRef.emit('yt-page-data-updated');
  await controller.currentTask;
  assert.equal(controller.translationContextId, contextId);
  assert.equal(fetches, 1);
  assert.equal(translations, 1);
  assert.equal(controller.activatedVideo, video);
  controller.dispose();
});

test('controller initialized on a non-watch page activates after home-to-watch SPA navigation', async () => {
  const windowRef = new FakeWindow('/', '');
  const controller = new TestController({
    windowRef,
    documentRef: {},
    runtimeApi: { storage: { onChanged: new ListenerSet() } },
    settingsReader: async () => ({ ytBilingualOverlay: true, targetLang: 'zh' }),
    navigationDelayMs: 0,
    requestAnimationFrameImpl: () => 1,
    cancelAnimationFrameImpl: () => {}
  });

  await controller.start();
  assert.equal(controller.loads.length, 0);
  windowRef.location.pathname = '/watch';
  windowRef.location.search = '?v=from-home';
  windowRef.emit('yt-navigate-finish');
  await Promise.resolve();
  const task = controller.currentTask;
  controller.pendingLoads.get('from-home').resolve({
    cues: [{ start: 0, end: 1_000, src: 'x', tgt: 'y' }],
    video: { id: 'from-home' }
  });
  await task;
  assert.deepEqual(controller.activations, ['from-home']);
  controller.dispose();
});

test('cue gaps resolve to null so the ticker clears the previous subtitle', () => {
  const cues = [
    { start: 0, end: 1_000, src: 'one', tgt: '一' },
    { start: 2_000, end: 3_000, src: 'two', tgt: '二' }
  ];
  assert.equal(cueStateAtTime(cues, 500, -1).cue?.src, 'one');
  assert.deepEqual(cueStateAtTime(cues, 1_500, 0), { index: -1, cue: null });
});

test('BFCache suspends work and pageshow starts a fresh generation without duplicating listeners', async () => {
  const windowRef = new FakeWindow('/watch', '?v=cache');
  const controller = new TestController({
    windowRef,
    documentRef: {},
    runtimeApi: { storage: { onChanged: new ListenerSet() } },
    settingsReader: async () => ({ ytBilingualOverlay: true, targetLang: 'zh' }),
    navigationDelayMs: 0,
    requestAnimationFrameImpl: () => 1,
    cancelAnimationFrameImpl: () => {}
  });

  const firstTask = controller.start();
  await Promise.resolve();
  const firstSignal = controller.loads[0].signal;
  const staleLoad = controller.pendingLoads.get('cache');
  windowRef.emit('pagehide', { persisted: true });
  assert.equal(firstSignal.aborted, true);
  assert.equal(controller.started, true);
  assert.equal(controller.overlay, null);
  assert.equal(windowRef.listenerCount('yt-navigate-finish'), 1);

  windowRef.emit('pageshow', { persisted: true });
  await Promise.resolve();
  const restoredTask = controller.currentTask;
  const restored = controller.pendingLoads.get('cache');
  restored.resolve({
    cues: [{ start: 0, end: 1_000, src: 'x', tgt: 'y' }],
    video: { id: 'cache-restored' }
  });
  await restoredTask;
  assert.deepEqual(controller.activations, ['cache-restored']);
  controller.dispose();

  // Resolve the stale first task after disposal; it must not activate.
  staleLoad.resolve({ cues: [{ start: 0, end: 1, src: 'x', tgt: 'x' }], video: { id: 'stale' } });
  await firstTask;
  assert.deepEqual(controller.activations, ['cache-restored']);
});

test('content bootstraps the controller on every YouTube route and controller owns cleanup', async () => {
  const [content, youtube] = await Promise.all([
    readFile(new URL('../content/content.js', import.meta.url), 'utf8'),
    readFile(new URL('../content/youtube.js', import.meta.url), 'utf8')
  ]);
  const bootstrap = content.slice(content.indexOf('// ---- YouTube overlay ----'));

  assert.match(bootstrap, /const onYouTube/);
  assert.doesNotMatch(bootstrap, /pathname\.startsWith\('\/watch'\)/);
  assert.match(youtube, /let singletonController = null/);
  assert.match(youtube, /workController\.abort\(error\)/);
  assert.match(youtube, /createTranslationRequestId\('youtube-context'\)/);
  assert.match(youtube, /youtubeTaskFingerprint\(this\.window\.location\)/);
  assert.match(youtube, /closeContext:\s*false/);
  assert.match(youtube, /intent:\s*'youtube',[\s\S]*?contextId/);
  assert.match(youtube, /closeTranslationContext\(this\.translationContextId/);
  assert.ok(
    youtube.indexOf("this.document.querySelector('video.html5-main-video')")
      < youtube.indexOf('const sourceData = await fetchJsonTrack'),
    'the player must exist before caption translation begins'
  );
  assert.match(youtube, /renderCue\(next\.cue\)/);
  assert.match(youtube, /storage\?\.onChanged\?\.removeListener/);
});
