import { getSettings } from '../core/settings.js';
import { createBatchPayload, splitBatchTranslation } from '../core/batchTranslation.js';
import {
  closeTranslationContext,
  createTranslationRequestId,
  sendCancellableTranslation
} from '../core/translationRpc.js';
import { createAbortError, isAbortError, throwIfAborted } from '../core/utils.js';

const api = globalThis.browser ?? globalThis.chrome;
const NAVIGATION_EVENTS = ['yt-navigate-finish', 'yt-page-data-updated'];
const YOUTUBE_SETTING_KEYS = new Set([
  'targetLang',
  'ytBilingualOverlay',
  'ytPreferBuiltIn'
]);
const NAVIGATION_SETTLE_MS = 300;
const PLAYER_RETRY_MS = 250;
const PLAYER_RETRY_COUNT = 6;

function isWatchRoute(locationRef) {
  return /(^|\.)youtube\.com$/.test(locationRef?.hostname || '')
    && String(locationRef?.pathname || '').startsWith('/watch');
}

function currentVideoId(locationRef) {
  try { return new URLSearchParams(locationRef?.search || '').get('v') || ''; }
  catch { return ''; }
}

export function youtubeTaskFingerprint(locationRef) {
  const videoId = currentVideoId(locationRef);
  if (isWatchRoute(locationRef) && videoId) return `watch:${videoId}`;
  return `route:${String(locationRef?.hostname || '')}${String(locationRef?.pathname || '')}${String(locationRef?.search || '')}`;
}

function getPlayerResponse(documentRef, windowRef) {
  const host = documentRef.querySelector('ytd-watch-flexy');
  const attr = host?.getAttribute?.('player-response');
  if (attr) {
    try { return JSON.parse(attr); } catch { }
  }
  return host?.playerResponse
    || host?.__data?.playerResponse
    || windowRef.ytInitialPlayerResponse
    || null;
}

function pickTrack(tracks) {
  return tracks.find(track => track.kind !== 'asr') || tracks[0];
}

export function normalizeCaptionEvents(events = []) {
  return events
    .filter(event => event?.segs?.length)
    .map(event => {
      const text = event.segs
        .map(segment => segment.utf8 || '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        start: event.tStartMs,
        end: event.tStartMs + (event.dDurationMs || 2_000),
        text
      };
    })
    .filter(cue => cue.text);
}

async function fetchJsonTrack(baseUrl, {
  tlang,
  signal,
  fetchImpl = globalThis.fetch
} = {}) {
  const url = new URL(baseUrl);
  if (!url.searchParams.has('fmt')) url.searchParams.set('fmt', 'json3');
  if (tlang) url.searchParams.set('tlang', tlang);
  const response = await fetchImpl(url.toString(), {
    credentials: 'same-origin',
    signal
  });
  if (!response.ok) throw new Error(`timedtext fetch ${response.status}`);
  return response.json();
}

export function alignCaptionCues(sourceCues, targetCues) {
  let targetIndex = 0;
  return sourceCues.map(source => {
    while (
      targetIndex + 1 < targetCues.length
      && Math.abs(targetCues[targetIndex + 1].start - source.start)
        < Math.abs(targetCues[targetIndex].start - source.start)
    ) {
      targetIndex += 1;
    }
    return {
      start: source.start,
      end: source.end,
      src: source.text,
      tgt: targetCues[targetIndex]?.text || ''
    };
  });
}

async function providerTranslateCues(cues, targetLang, {
  contextId,
  signal,
  sendTranslation = sendCancellableTranslation
} = {}) {
  const chunkSize = 40;
  const translatedParts = [];

  for (let index = 0; index < cues.length; index += chunkSize) {
    throwIfAborted(signal);
    const slice = cues.slice(index, index + chunkSize);
    let response;
    try {
      response = await sendTranslation({
        text: createBatchPayload(slice.map(cue => cue.text)),
        targetLang,
        intent: 'youtube',
        contextId
      }, {
        signal,
        prefix: 'youtube'
      });
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      console.warn('[IT] YouTube chunk translation failed');
      translatedParts.push(...Array(slice.length).fill(''));
      continue;
    }

    if (!response?.ok) {
      if (response?.code === 'TRANSLATION_CANCELLED' || signal?.aborted) {
        throw createAbortError(signal);
      }
      console.warn('[IT] YouTube chunk translation failed');
      translatedParts.push(...Array(slice.length).fill(''));
      continue;
    }
    const batch = splitBatchTranslation(response.result?.translated || '', slice.length);
    if (!batch.matched) {
      console.warn('[IT] YouTube translation count mismatch', {
        expected: batch.expectedCount,
        actual: batch.actualCount
      });
    }
    translatedParts.push(...batch.items);
  }

  return cues.map((cue, index) => ({
    start: cue.start,
    end: cue.end,
    text: translatedParts[index] || ''
  }));
}

export function binarySearchCue(list, timeMs) {
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const cue = list[middle];
    if (timeMs < cue.start) high = middle - 1;
    else if (timeMs > cue.end) low = middle + 1;
    else return middle;
  }
  return -1;
}

export function cueStateAtTime(list, timeMs, previousIndex = -1) {
  let index = previousIndex;
  if (
    index < 0
    || index >= list.length
    || timeMs < list[index].start
    || timeMs > list[index].end
  ) {
    index = binarySearchCue(list, timeMs);
  }
  return { index, cue: index >= 0 ? list[index] : null };
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
  }[character]));
}

export class YouTubeOverlayController {
  constructor({
    windowRef = globalThis.window,
    documentRef = globalThis.document,
    runtimeApi = api,
    settingsReader = getSettings,
    fetchImpl = globalThis.fetch,
    sendTranslation = sendCancellableTranslation,
    navigationDelayMs = NAVIGATION_SETTLE_MS,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
    requestAnimationFrameImpl = globalThis.requestAnimationFrame,
    cancelAnimationFrameImpl = globalThis.cancelAnimationFrame
  } = {}) {
    this.window = windowRef;
    this.document = documentRef;
    this.runtimeApi = runtimeApi;
    this.settingsReader = settingsReader;
    this.fetchImpl = fetchImpl;
    this.sendTranslation = sendTranslation;
    this.navigationDelayMs = navigationDelayMs;
    this.setTimeout = setTimeoutImpl;
    this.clearTimeout = clearTimeoutImpl;
    this.requestAnimationFrame = requestAnimationFrameImpl;
    this.cancelAnimationFrame = cancelAnimationFrameImpl;

    this.started = false;
    this.generation = 0;
    this.workController = null;
    this.navigationTimer = null;
    this.delayTimers = new Set();
    this.currentTask = null;
    this.translationContextId = null;
    this.taskFingerprint = null;
    this.overlay = null;
    this.currentCues = [];
    this.lastCueIndex = -1;
    this.rafId = 0;

    this.onNavigation = () => { this.scheduleRefresh(this.navigationDelayMs); };
    this.onPopState = () => { this.scheduleRefresh(this.navigationDelayMs); };
    this.onPageHide = event => {
      if (!event?.persisted) {
        this.dispose();
        return;
      }
      this.generation += 1;
      this.cancelWork('YouTube page entered the back-forward cache.');
      this.unmountOverlay();
      this.currentTask = null;
    };
    this.onPageShow = event => {
      if (event?.persisted && this.started) {
        this.scheduleRefresh(0, { forceContextRotation: true });
      }
    };
    this.onSettingsChanged = (changes, area) => {
      if (area !== 'sync') return;
      if (!Object.keys(changes || {}).some(key => YOUTUBE_SETTING_KEYS.has(key))) return;
      this.scheduleRefresh(0, { forceContextRotation: true });
    };
  }

  start() {
    if (this.started) return this.currentTask || Promise.resolve();
    this.started = true;
    NAVIGATION_EVENTS.forEach(eventName => {
      this.window.addEventListener(eventName, this.onNavigation);
    });
    this.window.addEventListener('popstate', this.onPopState);
    this.window.addEventListener('pagehide', this.onPageHide);
    this.window.addEventListener('pageshow', this.onPageShow);
    this.runtimeApi?.storage?.onChanged?.addListener?.(this.onSettingsChanged);
    return this.scheduleRefresh(0);
  }

  scheduleRefresh(delayMs = 0, { forceContextRotation = false } = {}) {
    if (!this.started) return Promise.resolve();
    const taskFingerprint = youtubeTaskFingerprint(this.window.location);
    const sameTask = taskFingerprint === this.taskFingerprint;
    const canReuseContext = sameTask
      && !forceContextRotation
      && !!this.translationContextId;

    if (canReuseContext) {
      // YouTube can emit both navigation events for the same video, including
      // after the debounce has elapsed. Do not abort a healthy task or rotate
      // its conversation merely because the duplicate event arrived late.
      if (this.navigationTimer || this.currentTask || (this.overlay && this.overlay.isConnected !== false)) {
        return this.currentTask || Promise.resolve();
      }
      // A failed/not-yet-ready setup may retry on a later event, but it keeps
      // the same task context so the first-turn prompt is not sent again.
      this.cancelWork('YouTube video refreshed.', { closeContext: false });
    } else {
      this.cancelWork('YouTube video changed.');
      this.taskFingerprint = taskFingerprint;
      this.translationContextId = createTranslationRequestId('youtube-context');
    }
    this.unmountOverlay();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.workController = controller;

    if (delayMs > 0) {
      this.navigationTimer = this.setTimeout(() => {
        this.navigationTimer = null;
        this.executeRefresh(generation, controller);
      }, delayMs);
      return Promise.resolve();
    }
    return this.executeRefresh(generation, controller);
  }

  executeRefresh(generation, controller) {
    const task = this.refresh(generation, controller.signal)
      .catch(error => {
        if (!isAbortError(error, controller.signal)) {
          console.warn('[IT] YouTube overlay setup failed');
        }
      })
      .finally(() => {
        if (this.currentTask === task) this.currentTask = null;
      });
    this.currentTask = task;
    return task;
  }

  isCurrent(generation, signal) {
    return this.started
      && !signal.aborted
      && generation === this.generation
      && this.workController?.signal === signal;
  }

  async refresh(generation, signal) {
    const settings = await this.settingsReader();
    if (!this.isCurrent(generation, signal)) return;
    if (!settings.ytBilingualOverlay || !isWatchRoute(this.window.location)) return;

    const loaded = await this.loadCurrentVideo({ settings, generation, signal });
    if (!this.isCurrent(generation, signal) || !loaded?.cues?.length) return;
    this.mountOverlay();
    if (!this.isCurrent(generation, signal) || !this.overlay) return;
    this.currentCues = loaded.cues;
    this.lastCueIndex = -1;
    this.startTicker(loaded.video, generation, signal);
  }

  async loadCurrentVideo({ settings, generation, signal }) {
    let tracks = [];
    const expectedVideoId = currentVideoId(this.window.location);
    for (let attempt = 0; attempt < PLAYER_RETRY_COUNT; attempt += 1) {
      throwIfAborted(signal);
      const playerResponse = getPlayerResponse(this.document, this.window);
      const responseVideoId = playerResponse?.videoDetails?.videoId || '';
      tracks = expectedVideoId && responseVideoId && expectedVideoId !== responseVideoId
        ? []
        : (playerResponse?.captions
          ?.playerCaptionsTracklistRenderer
          ?.captionTracks
          || []);
      if (tracks.length) break;
      if (attempt + 1 < PLAYER_RETRY_COUNT) {
        await this.sleep(PLAYER_RETRY_MS, signal);
      }
    }
    if (!this.isCurrent(generation, signal) || !tracks.length) return null;

    // Do not perform caption translation until there is a player that can own
    // the result. A later same-video event can retry without paying for or
    // repeating a complete translation first.
    const video = this.document.querySelector('video.html5-main-video')
      || this.document.querySelector('video');
    if (!video) return null;

    const track = pickTrack(tracks);
    const sourceData = await fetchJsonTrack(track.baseUrl, {
      signal,
      fetchImpl: this.fetchImpl
    });
    const sourceCues = normalizeCaptionEvents(sourceData.events);
    if (!sourceCues.length) return null;

    const targetLang = settings.targetLang || 'zh';
    const tryBuiltIn = async () => {
      if (track.isTranslatable === false) return null;
      try {
        const targetData = await fetchJsonTrack(track.baseUrl, {
          tlang: targetLang,
          signal,
          fetchImpl: this.fetchImpl
        });
        const cues = normalizeCaptionEvents(targetData.events);
        return cues.length ? cues : null;
      } catch (error) {
        if (isAbortError(error, signal)) throw error;
        return null;
      }
    };
    const tryProvider = async () => {
      try {
        const cues = await providerTranslateCues(sourceCues, targetLang, {
          contextId: this.translationContextId,
          signal,
          sendTranslation: this.sendTranslation
        });
        return cues.length ? cues : null;
      } catch (error) {
        if (isAbortError(error, signal)) throw error;
        return null;
      }
    };

    const targetCues = settings.ytPreferBuiltIn !== false
      ? (await tryBuiltIn() || await tryProvider())
      : (await tryProvider() || await tryBuiltIn());
    if (!targetCues || !this.isCurrent(generation, signal)) return null;

    return { cues: alignCaptionCues(sourceCues, targetCues), video };
  }

  sleep(delayMs, signal) {
    throwIfAborted(signal);
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => {
        this.delayTimers.delete(timer);
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        this.clearTimeout(timer);
        cleanup();
        reject(createAbortError(signal));
      };
      timer = this.setTimeout(() => {
        cleanup();
        resolve();
      }, delayMs);
      this.delayTimers.add(timer);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }

  mountOverlay() {
    this.unmountOverlay();
    const overlay = this.document.createElement('div');
    overlay.dataset.itYoutubeOverlay = 'true';
    overlay.style.cssText = 'position:absolute;left:0;right:0;bottom:10%;margin:auto;width:96%;text-align:center;pointer-events:none;font-family:system-ui,-apple-system,Segoe UI,Roboto,Noto Sans,sans-serif;text-shadow:0 2px 6px rgba(0,0,0,.6);z-index:2147483647;';
    const player = this.document.querySelector('.html5-video-player')
      || this.document.querySelector('#movie_player');
    (player || this.document.body).appendChild(overlay);
    this.overlay = overlay;
  }

  unmountOverlay() {
    if (this.rafId) this.cancelAnimationFrame?.(this.rafId);
    this.rafId = 0;
    this.overlay?.remove?.();
    this.overlay = null;
    this.currentCues = [];
    this.lastCueIndex = -1;
  }

  renderCue(cue) {
    if (!this.overlay) return;
    if (!cue) {
      this.overlay.replaceChildren();
      return;
    }
    this.overlay.innerHTML = `<div style="display:inline-block;background:rgba(0,0,0,.55);border-radius:8px;padding:6px 10px;max-width:90%;">
      <div style="color:#fff;font-size:18px;line-height:1.25;">${escapeHTML(cue.src)}</div>
      <div style="color:#b7e3ff;font-size:18px;line-height:1.25;margin-top:2px;">${escapeHTML(cue.tgt)}</div>
    </div>`;
  }

  startTicker(video, generation, signal) {
    const step = () => {
      if (!this.isCurrent(generation, signal) || !video?.isConnected) return;
      const next = cueStateAtTime(
        this.currentCues,
        (video.currentTime || 0) * 1_000,
        this.lastCueIndex
      );
      if (next.index !== this.lastCueIndex) {
        this.lastCueIndex = next.index;
        // A null cue is an intentional subtitle gap; clear the previous cue.
        this.renderCue(next.cue);
      }
      this.rafId = this.requestAnimationFrame(step);
    };
    step();
  }

  cancelWork(reason, { closeContext = true } = {}) {
    if (this.navigationTimer) {
      this.clearTimeout(this.navigationTimer);
      this.navigationTimer = null;
    }
    if (this.workController && !this.workController.signal.aborted) {
      const error = new Error(reason || 'YouTube translation cancelled.');
      error.name = 'AbortError';
      error.code = 'TRANSLATION_CANCELLED';
      this.workController.abort(error);
    }
    this.workController = null;
    if (closeContext && this.translationContextId) {
      void closeTranslationContext(this.translationContextId, this.runtimeApi);
      this.translationContextId = null;
    }
    for (const timer of this.delayTimers) this.clearTimeout(timer);
    this.delayTimers.clear();
  }

  dispose() {
    if (!this.started) return;
    this.started = false;
    NAVIGATION_EVENTS.forEach(eventName => {
      this.window.removeEventListener(eventName, this.onNavigation);
    });
    this.window.removeEventListener('popstate', this.onPopState);
    this.window.removeEventListener('pagehide', this.onPageHide);
    this.window.removeEventListener('pageshow', this.onPageShow);
    this.runtimeApi?.storage?.onChanged?.removeListener?.(this.onSettingsChanged);
    this.generation += 1;
    this.cancelWork('YouTube overlay disposed.');
    this.taskFingerprint = null;
    this.unmountOverlay();
    this.currentTask = null;
  }
}

let singletonController = null;

export function initYouTubeOverlay() {
  if (!singletonController) singletonController = new YouTubeOverlayController();
  void singletonController.start();
  return singletonController;
}

export function destroyYouTubeOverlay() {
  singletonController?.dispose();
  singletonController = null;
}
