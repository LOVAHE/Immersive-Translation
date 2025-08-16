// offscreen/offscreen.js
import { getProvider } from '../providers/index.js';
import { getSettings } from '../core/settings.js';
import { createLogger } from '../core/log.js';

const L = createLogger('offscreen');
let provider;

// The main message handler for the offscreen document.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg.target || msg.target !== 'offscreen') {
      return;
    }
    L.info('message received', msg.action);

    try {
      // Lazy-initialize the provider on first use.
      if (!provider) {
        const settings = await getSettings();
        // We know this will be 'chrome-ai' because the background script
        // only routes 'chrome-ai' tasks here.
        provider = getProvider('chrome-ai', settings);
      }

      let result;
      switch (msg.action) {
        case 'translate':
          result = await provider.translate(msg.details);
          break;
        case 'define':
          result = await provider.define(msg.details);
          break;
        case 'visionTranslate':
          result = await provider.visionTranslate(msg.details);
          break;
        default:
          throw new Error(`Unknown offscreen action: ${msg.action}`);
      }
      sendResponse({ ok: true, result });
    } catch (err) {
      L.error('offscreen task failed', err);
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  // Return true to indicate that the response will be sent asynchronously.
  return true;
});

L.info('Offscreen document loaded.');
