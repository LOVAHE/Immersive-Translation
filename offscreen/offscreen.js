// offscreen/offscreen.js
import { getProvider } from '../providers/index.js';
import { getSettings } from '../core/settings.js';
import { createLogger, setDebugLogging } from '../core/log.js';
import { applyDebugSettingChange } from '../core/debugSettings.js';
import { isAbortError } from '../core/utils.js';

const L = createLogger('offscreen');
let provider;
const activeRequests = new Map();

// The offscreen document has its own JavaScript realm, so changing the
// background logger flag does not update this copy of core/log.js.
chrome.storage.onChanged.addListener((changes, area) => {
  applyDebugSettingChange(changes, area);
});

// The main message handler for the offscreen document.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  (async () => {
    if (msg.action === 'cancel') {
      const controller = activeRequests.get(msg.requestId);
      if (controller) {
        activeRequests.delete(msg.requestId);
        const error = new Error('Chrome AI translation cancelled.');
        error.name = 'AbortError';
        error.code = 'TRANSLATION_CANCELLED';
        controller.abort(error);
      }
      sendResponse({ ok: true, cancelled: !!controller });
      return;
    }
    L.info('message received', msg.action);

    const requestId = typeof msg.requestId === 'string' ? msg.requestId : null;
    const controller = new AbortController();
    if (requestId) {
      if (activeRequests.has(requestId)) {
        sendResponse({ ok: false, error: 'Duplicate Chrome AI request.' });
        return;
      }
      activeRequests.set(requestId, controller);
    }

    try {
      // Lazy-initialize the provider on first use.
      if (!provider) {
        const settings = await getSettings();
        setDebugLogging(settings.debug);
        // We know this will be 'chrome-ai' because the background script
        // only routes 'chrome-ai' tasks here.
        provider = getProvider('chrome-ai', settings);
      }

      let result;
      const details = { ...msg.details, signal: controller.signal };
      switch (msg.action) {
        case 'translate':
          result = await provider.translate(details);
          break;
        case 'define':
          result = await provider.define(details);
          break;
        case 'visionTranslate':
          result = await provider.visionTranslate(details);
          break;
        default:
          throw new Error(`Unknown offscreen action: ${msg.action}`);
      }
      sendResponse({ ok: true, result });
    } catch (err) {
      if (!isAbortError(err, controller.signal)) L.error('offscreen task failed', err);
      sendResponse({
        ok: false,
        error: isAbortError(err, controller.signal)
          ? 'Translation cancelled.'
          : (err.message || String(err)),
        code: isAbortError(err, controller.signal) ? 'TRANSLATION_CANCELLED' : err?.code
      });
    } finally {
      if (requestId && activeRequests.get(requestId) === controller) {
        activeRequests.delete(requestId);
      }
    }
  })();

  // Return true to indicate that the response will be sent asynchronously.
  return true;
});

L.info('Offscreen document loaded.');
