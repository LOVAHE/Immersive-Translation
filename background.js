// background.js

import { createContextMenus, isAbortError } from './core/utils.js';
import { handleTranslate, handleVisionTranslate } from './core/router.js';
import { getProvider } from './providers/index.js';
import { api, callApi } from './core/browser.js';
import { removePdfRequest, savePdfRequest } from './core/pdfHandoff.js';
import { getSettings, setSettings } from './core/settings.js';
import { initI18n, t } from './core/i18n.js';
import { createLogger, setDebugLogging } from './core/log.js';
import { closeCodexNativeSession, getCodexNativeHealth } from './core/codexNative.js';
import {
  TranslationRequestRegistry,
  translationRequestOwner
} from './core/translationRequests.js';

const L = createLogger('bg');
const translationRequests = new TranslationRequestRegistry();
L.info('Background (static) loaded');

// ---- helpers ----
async function isForbiddenUrl(url = '') {
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome:' || u.protocol === 'edge:' || u.protocol === 'about:') return true;
    if (u.protocol === 'chrome-extension:' || u.hostname === 'chromewebstore.google.com') return true;
    return false;
  } catch { return false; }
}
async function ensureContentScript(tabId, tabUrl, frameId) {
  if (await isForbiddenUrl(tabUrl)) throw new Error('This page forbids content scripts.');
  if (!api.scripting?.executeScript) throw new Error('Dynamic content script injection is not supported in this browser.');
  const target = Number.isInteger(frameId) && frameId !== 0
    ? { tabId, frameIds: [frameId] }
    : { tabId };
  await api.scripting.executeScript({ target, files: ['content/content.js'] });
}
async function sendToTabSafe(tabId, msg, tabUrl, frameId, { allowInjection = true } = {}) {
  frameId = Number.isInteger(frameId) ? frameId : 0;
  const send = () => api.tabs.sendMessage(tabId, msg, { frameId });
  try { return await send(); }
  catch (e) {
    if (String(e).includes('Receiving end does not exist')) {
      // A selection result must return to the content script that captured its
      // original Range. Injecting after the click cannot reconstruct that state.
      if (!allowInjection) throw e;
      await ensureContentScript(tabId, tabUrl, frameId);
      return await send();
    }
    throw e;
  }
}

async function tabStillAtUrl(tabId, expectedUrl) {
  if (!Number.isInteger(tabId) || !expectedUrl || typeof api.tabs?.get !== 'function') return false;
  try {
    const current = await callApi(api.tabs.get.bind(api.tabs), tabId);
    return current?.url === expectedUrl;
  } catch {
    return false;
  }
}

function permissionOriginForPdf(src) {
  const url = new URL(src);
  if (url.protocol === 'file:') return 'file:///*';
  if (url.protocol === 'http:' || url.protocol === 'https:') return `${url.protocol}//${url.host}/*`;
  throw new Error('Only web and local-file PDF links are supported.');
}

async function openPdfReader(src) {
  const origin = permissionOriginForPdf(src);
  const granted = await callApi(api.permissions.request.bind(api.permissions), { origins: [origin] });
  if (!granted) throw new Error('Permission to read this PDF was not granted.');

  const requestId = crypto.randomUUID();
  // Stored under pdfRequest:<uuid>; the reader consumes and removes it once.
  await savePdfRequest({ requestId, src });
  const readerUrl = `${api.runtime.getURL('pages/pdf_viewer.html')}#request=${encodeURIComponent(requestId)}`;
  try {
    await callApi(api.tabs.create.bind(api.tabs), { url: readerUrl });
  } catch (error) {
    await removePdfRequest(requestId).catch(() => {});
    throw error;
  }
}

// ---- menus ----
async function buildMenus() {
  const s = await getSettings();
  setDebugLogging(s.debug);
  await initI18n(s.uiLang || 'en');
  await createContextMenus([
    { id: 'translate-selection', title: t('menuTranslate'), contexts: ['selection'] },
    { id: 'translate-page', title: t('menuTranslatePage'), contexts: ['page'] },
    { id: 'translate-image', title: t('menuTranslateImage'), contexts: ['image'] },
    { id: 'translate-pdf', title: t('menuTranslatePDF'), contexts: ['link', 'page'] }
  ]);
}
buildMenus().catch(e => L.error('buildMenus error', e));

// ---- context menus ----
api.contextMenus.onClicked.addListener(async (info, tab) => {
  const tabId = tab?.id;
  const tabUrl = tab?.url || '';
  let selectionCapture = null;
  L.info('menu click', { id: info.menuItemId });

  try {
    if (info.menuItemId === 'translate-selection' && info.selectionText) {
      L.debug('selection received', { length: info.selectionText.length });
      selectionCapture = await sendToTabSafe(tabId, {
        action: 'getSelectionCapture',
        sourceText: info.selectionText,
        sourceUrl: info.frameUrl || tabUrl
      }, info.frameUrl || tabUrl, info.frameId, { allowInjection: false });
      if (!selectionCapture?.ok ||
          !selectionCapture.captureId ||
          !Number.isInteger(selectionCapture.generation)) {
        selectionCapture = null;
        throw new Error('Selection is no longer available.');
      }
      const result = await handleTranslate({ text: info.selectionText, intent: 'selection' });
      L.info('selection done', { mode: result.mode, provider: result.provider });
      if (!await tabStillAtUrl(tabId, tabUrl)) return;
      await sendToTabSafe(tabId, {
        action: 'showTranslation',
        sourceText: info.selectionText,
        sourceUrl: info.frameUrl || tabUrl,
        selectionCaptureId: selectionCapture.captureId,
        selectionGeneration: selectionCapture.generation,
        result
      }, info.frameUrl || tabUrl, info.frameId, { allowInjection: false });
    }
    if (info.menuItemId === 'translate-page') {
      await sendToTabSafe(
        tabId,
        { action: 'translatePage' },
        info.frameUrl || tabUrl,
        info.frameId
      );
    }
    if (info.menuItemId === 'translate-image' && info.srcUrl) {
      await sendToTabSafe(
        tabId,
        { action: 'translateImageAtUrl', srcUrl: info.srcUrl },
        info.frameUrl || tabUrl,
        info.frameId
      );
    }
    if (info.menuItemId === 'translate-pdf') {
      let pdfUrl = info.linkUrl;
      if (!pdfUrl && tabUrl?.toLowerCase().includes('.pdf')) pdfUrl = tabUrl;
      if (pdfUrl) await openPdfReader(pdfUrl);
    }
  } catch (e) {
    L.error('menu action error', e);
    if (info.menuItemId === 'translate-pdf') {
      const readerUrl = `${api.runtime.getURL('pages/pdf_viewer.html')}#error=permission`;
      await callApi(api.tabs.create.bind(api.tabs), { url: readerUrl }).catch(() => {});
      return;
    }
    if (info.menuItemId === 'translate-selection' && !await tabStillAtUrl(tabId, tabUrl)) return;
    if (info.menuItemId === 'translate-selection' && !selectionCapture) return;
    try {
      await sendToTabSafe(tabId, {
        action: 'showTranslation',
        sourceText: info.selectionText || '',
        sourceUrl: info.frameUrl || tabUrl,
        selectionCaptureId: selectionCapture.captureId,
        selectionGeneration: selectionCapture.generation,
        result: { error: e.message || String(e) }
      }, info.frameUrl || tabUrl, info.frameId, { allowInjection: false });
    } catch { }
  }
});

// ---- RPC ----
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.action === 'log') {
      const lvl = msg.level || 'info';
      const S = createLogger(msg.scope || 'page');
      S[lvl]?.(msg.msg || '', msg.error || {});
      return sendResponse?.({ ok: true });
    }
    if (msg?.action === 'ping') {
      L.info('ping from', sender?.url || sender?.tab?.url);
      return sendResponse({ pong: true });
    }
    if (msg?.action === 'selfTest') {
      try {
        const s = await getSettings();
        const provider = getProvider(s.provider, s);
        const out = await provider.translate({ text: 'Hello', sourceLang: 'auto', targetLang: s.targetLang || 'zh' });
        return sendResponse({ ok: true, result: { provider: s.provider, sample: out.translated } });
      } catch (err) {
        L.error('selfTest error', err);
        return sendResponse({ ok: false, error: err.message || String(err) });
      }
    }
    if (msg?.action === 'cancelTranslation') {
      const cancelled = translationRequests.cancel(
        msg.requestId,
        translationRequestOwner(sender)
      );
      return sendResponse({ ok: true, cancelled });
    }
    if (msg?.action === 'closeTranslationContext') {
      const closed = await closeCodexNativeSession(msg.contextId);
      return sendResponse({ ok: true, closed });
    }
    if (msg?.action === 'translateText') {
      let ticket;
      try {
        ticket = translationRequests.start(
          msg.requestId,
          translationRequestOwner(sender)
        );
        const result = await handleTranslate({
          text: msg.text,
          sourceLang: msg.sourceLang,
          targetLang: msg.targetLang,
          intent: msg.intent,
          contextId: msg.contextId,
          signal: ticket.controller.signal
        });
        return sendResponse({ ok: true, result });
      } catch (err) {
        if (isAbortError(err, ticket?.controller.signal)) {
          return sendResponse({
            ok: false,
            error: 'Translation cancelled.',
            code: 'TRANSLATION_CANCELLED'
          });
        }
        L.error('translateText error', err);
        return sendResponse({ ok: false, error: err.message || String(err), code: err?.code });
      } finally {
        translationRequests.finish(ticket);
      }
    }
    if (msg?.action === 'visionTranslate') {
      try {
        const result = await handleVisionTranslate(msg.details);
        return sendResponse({ ok: true, result });
      } catch (err) {
        L.error('visionTranslate error', err);
        return sendResponse({ ok: false, error: err.message || String(err) });
      }
    }
    if (msg?.action === 'codexStatus') {
      try {
        const health = await getCodexNativeHealth();
        return sendResponse({ ok: health?.service === 'ready', result: health });
      } catch (err) {
        return sendResponse({ ok: false, error: err?.message || String(err), code: err?.code });
      }
    }
    return sendResponse({ ok: false, error: 'Unknown background action' });
  })().catch(err => {
    L.error('message handler error', err);
    sendResponse({ ok: false, error: err?.message || String(err) });
  });
  return true;
});

// ---- react to settings / lifecycle ----
api.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  if (changes.debug) setDebugLogging(changes.debug.newValue);
  if (changes.uiLang) await buildMenus().catch(e => L.error('rebuild menus error', e));
});
api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await setSettings({ onboardingComplete: false });
    api.tabs.create({ url: api.runtime.getURL('options/options.html') });
  }
});
api.runtime.onStartup?.addListener?.(() => buildMenus().catch(e => L.error('startup menus error', e)));
