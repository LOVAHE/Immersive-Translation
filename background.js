// background.js

import { createContextMenus } from './core/utils.js';
import { handleTranslate, handleVisionTranslate } from './core/router.js';
import { getProvider } from './providers/index.js';
import { api } from './core/browser.js';
import { getSettings, setSettings } from './core/settings.js';
import { initI18n, t } from './core/i18n.js';
import { createLogger } from './core/log.js';

const L = createLogger('bg');
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
async function ensureContentScript(tabId, tabUrl) {
  if (await isForbiddenUrl(tabUrl)) throw new Error('This page forbids content scripts.');
  if (!api.scripting?.executeScript) throw new Error('Dynamic content script injection is not supported in this browser.');
  await api.scripting.executeScript({ target: { tabId }, files: ['content/content.js'] });
}
async function sendToTabSafe(tabId, msg, tabUrl) {
  try { return await api.tabs.sendMessage(tabId, msg); }
  catch (e) {
    if (String(e).includes('Receiving end does not exist')) {
      await ensureContentScript(tabId, tabUrl);
      return await api.tabs.sendMessage(tabId, msg);
    }
    throw e;
  }
}

// ---- menus ----
async function buildMenus() {
  const s = await getSettings();
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
  L.info('menu click', { id: info.menuItemId });

  try {
    if (info.menuItemId === 'translate-selection' && info.selectionText) {
      L.debug('selection text', info.selectionText.slice(0, 160));
      const result = await handleTranslate({ text: info.selectionText, intent: 'selection' });
      L.info('selection done', { mode: result.mode, provider: result.provider });
      await sendToTabSafe(tabId, { action: 'showTranslation', result }, tabUrl);
    }
    if (info.menuItemId === 'translate-page') {
      await sendToTabSafe(tabId, { action: 'translatePage' }, tabUrl);
    }
    if (info.menuItemId === 'translate-image' && info.srcUrl) {
      await sendToTabSafe(tabId, { action: 'translateImageAtUrl', srcUrl: info.srcUrl }, tabUrl);
    }
    if (info.menuItemId === 'translate-pdf') {
      let pdfUrl = info.linkUrl;
      if (!pdfUrl && tabUrl?.toLowerCase().includes('.pdf')) pdfUrl = tabUrl;
      if (pdfUrl) {
        const url = api.runtime.getURL('pages/pdf_viewer.html') + '?src=' + encodeURIComponent(pdfUrl);
        api.tabs.create({ url });
      }
    }
  } catch (e) {
    L.error('menu action error', e);
    try { await sendToTabSafe(tabId, { action: 'showTranslation', result: { error: e.message || String(e) } }, tabUrl); } catch { }
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
    if (msg?.action === 'translateText') {
      try {
        const result = await handleTranslate({
          text: msg.text,
          sourceLang: msg.sourceLang,
          targetLang: msg.targetLang,
          intent: msg.intent
        });
        return sendResponse({ ok: true, result });
      } catch (err) {
        L.error('translateText error', err);
        return sendResponse({ ok: false, error: err.message || String(err) });
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
  if (changes.uiLang) await buildMenus().catch(e => L.error('rebuild menus error', e));
});
api.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await setSettings({ onboardingComplete: false });
    api.tabs.create({ url: api.runtime.getURL('options/options.html') });
  }
});
api.runtime.onStartup?.addListener?.(() => buildMenus().catch(e => L.error('startup menus error', e)));
