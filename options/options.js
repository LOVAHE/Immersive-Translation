// options/options.js

import {
  SECRET_SETTING_KEYS,
  getSettings,
  normalizeCodexModel,
  setSettings
} from '../core/settings.js';
import { initI18n, t } from '../core/i18n.js';
import { ChromeAiTranslate } from '../providers/chromeAi.js';
import { getProviderDefinition } from '../providers/catalog.js';
import { requestCodexNativePermission } from '../core/codexNative.js';
import { callApi } from '../core/browser.js';

const api = (globalThis.browser ?? globalThis.chrome);

const keyFields = [
  'googleApiKey',
  'azureKey', 'azureRegion',
  'deeplKey',
  'openaiKey', 'openaiBaseUrl', 'openaiModel',
  'geminiKey', 'geminiModel'
];
const secretFields = new Set(SECRET_SETTING_KEYS);

const KEY_LABEL = {
  googleApiKey:   'Google API Key',
  azureKey:       'Azure Translator Key',
  azureRegion:    'Azure Region (e.g. eastus)',
  deeplKey:       'DeepL Key',
  openaiKey:      'OpenAI Key',
  openaiBaseUrl:  'OpenAI Base URL (default https://api.openai.com/v1)',
  openaiModel:    'OpenAI Model (e.g. gpt-5-mini)',
  geminiKey:      'Gemini API Key',
  geminiModel:    'Gemini Model (e.g. gemini-2.5-flash)'
};

const KEY_PLACEHOLDER = {
  azureRegion:   'eastus / westeurope / ...',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel:   'gpt-5-mini',
  geminiModel:   'gemini-2.5-flash'
};

const STYLE_DEFAULTS = {
  translationFontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif',
  translationFontSize: '14',
  translationTheme: 'none',
  translationThemeMode: 'auto',
  translationTextColor: '#0f172a',
  translationBubbleColor: '#ffffff',
  translationBorderColor: '#e2e8f0'
};
const TRANSLATION_THEMES = new Set(['none', 'underline', 'dashed', 'highlight', 'weakening', 'mask', 'bold', 'italic']);

/* =========================
   Helpers & i18n
   ========================= */
function $(id) { return document.getElementById(id); }

function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    if (k) el.textContent = t(k);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const k = el.getAttribute('data-i18n-aria-label');
    if (k) el.setAttribute('aria-label', t(k));
  });
  root.querySelectorAll('[data-i18n-alt]').forEach(el => {
    const k = el.getAttribute('data-i18n-alt');
    if (k) el.setAttribute('alt', t(k));
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const k = el.getAttribute('data-i18n-placeholder');
    if (k) el.setAttribute('placeholder', t(k));
  });
  const codexStatus = root.querySelector?.('#codexProviderStatus[data-status-i18n]');
  if (codexStatus) codexStatus.textContent = t(codexStatus.dataset.statusI18n);
}

function errorMessage(err) {
  return err?.message || String(err || 'Unknown error');
}

function escHtml(value = '') {
  return String(value).replace(/[&<>"]/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;'
  }[ch]));
}

function renderKeysForm(s) {
  const keysDiv = $('keys');
  if (!keysDiv) return;
  keysDiv.innerHTML = '';

  const frag = document.createDocumentFragment();
  const mkRow = (id, label, placeholder, value) => {
    const wrap = document.createElement('div');
    wrap.className = 'block space-y-2';
    const safeId = escHtml(id);
    wrap.innerHTML = `
      <label class="block text-sm font-semibold text-slate-700 dark:text-slate-300" for="${safeId}">${escHtml(label)}</label>
      <input id="${safeId}" type="${secretFields.has(id) ? 'password' : 'text'}" autocomplete="off" spellcheck="false" class="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131315] px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none transition-all duration-200"
             placeholder="${escHtml(placeholder || '')}" value="${escHtml(value ? String(value) : '')}">
    `;
    return wrap;
  };

  keyFields.forEach(id => {
    frag.appendChild(mkRow(
      id,
      KEY_LABEL[id] || id,
      KEY_PLACEHOLDER[id] || '',
      s[id]
    ));
  });
  keysDiv.appendChild(frag);
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
}

function colorValue(id) {
  const text = $(`${id}Text`)?.value;
  const picker = $(id)?.value;
  return isHexColor(text) ? text : (isHexColor(picker) ? picker : STYLE_DEFAULTS[id]);
}

function syncColorPair(id, value) {
  const fallback = STYLE_DEFAULTS[id];
  const next = isHexColor(value) ? value : fallback;
  const picker = $(id);
  const text = $(`${id}Text`);
  if (picker) picker.value = next;
  if (text) text.value = next;
}

function safeThemeMode(value) {
  return ['auto', 'light', 'dark', 'custom'].includes(value) ? value : STYLE_DEFAULTS.translationThemeMode;
}

function safeTranslationTheme(value) {
  return TRANSLATION_THEMES.has(value) ? value : STYLE_DEFAULTS.translationTheme;
}

function hasCustomStyleColors(s = {}) {
  return [
    ['translationTextColor', STYLE_DEFAULTS.translationTextColor],
    ['translationBubbleColor', STYLE_DEFAULTS.translationBubbleColor],
    ['translationBorderColor', STYLE_DEFAULTS.translationBorderColor]
  ].some(([key, fallback]) => isHexColor(s[key]) && String(s[key]).toLowerCase() !== fallback.toLowerCase());
}

function updateStyleControlsState() {
  const custom = safeThemeMode($('translationThemeMode')?.value) === 'custom';
  ['translationTextColor', 'translationTextColorText', 'translationBubbleColor', 'translationBubbleColorText', 'translationBorderColor', 'translationBorderColorText'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.disabled = !custom;
    el.style.opacity = custom ? '1' : '.55';
  });
}

function readStylePatchFromForm() {
  const fontSize = Math.min(28, Math.max(10, Number($('translationFontSize')?.value || STYLE_DEFAULTS.translationFontSize)));
  return {
    translationFontFamily: $('translationFontFamily')?.value?.trim() || STYLE_DEFAULTS.translationFontFamily,
    translationFontSize: String(Number.isFinite(fontSize) ? fontSize : STYLE_DEFAULTS.translationFontSize),
    translationTheme: safeTranslationTheme($('translationTheme')?.value || STYLE_DEFAULTS.translationTheme),
    translationThemeMode: safeThemeMode($('translationThemeMode')?.value || STYLE_DEFAULTS.translationThemeMode),
    translationTextColor: colorValue('translationTextColor'),
    translationBubbleColor: colorValue('translationBubbleColor'),
    translationBorderColor: colorValue('translationBorderColor')
  };
}

function updateStylePreview() {
  const preview = $('stylePreview');
  if (!preview) return;
  const style = readStylePatchFromForm();
  updateStyleControlsState();
  preview.dataset.translationTheme = style.translationTheme;
  const target = $('stylePreviewTranslation');
  if (target) target.tabIndex = style.translationTheme === 'mask' ? 0 : -1;
}

function attachStyleControls() {
  ['translationTextColor', 'translationBubbleColor', 'translationBorderColor'].forEach(id => {
    const picker = $(id);
    const text = $(`${id}Text`);
    picker?.addEventListener('input', () => {
      if (text) text.value = picker.value;
      updateStylePreview();
    });
    text?.addEventListener('input', () => {
      if (isHexColor(text.value) && picker) picker.value = text.value;
      updateStylePreview();
    });
  });
  ['translationTheme', 'translationFontFamily', 'translationFontSize', 'translationThemeMode'].forEach(id => {
    $(id)?.addEventListener('input', updateStylePreview);
  });
}

/* =========================
   Read / write settings
   ========================= */
function readPatchFromForm() {
  const pick = id => ($(id) ? $(id).value : '');
  const pickBool = id => !!($(id) && $(id).checked);

  const rawProvider = pick('provider');
  const provider = (rawProvider === 'openai-compat') ? 'openai' : rawProvider;

  const patch = {
    provider,
    sourceLang: pick('sourceLang') || 'auto',
    targetLang: pick('targetLang') || 'zh',
    uiLang:     pick('uiLang')     || 'en',
    enableWordDictionary: pickBool('enableWordDictionary'),
    codexModel: pick('codexModelMode') === 'custom'
      ? pick('codexModel')
      : '',

    ytPreferBuiltIn: (pick('ytPrefer') === 'builtin'),
    ytBilingualOverlay: pickBool('ytBilingualOverlay'),

    ocrEnabled: pickBool('ocrEnabled'),
    ocrLangs:   pick('ocrLangs') || 'eng',
    ocrEngine:  pick('ocrEngine') || 'tesseract',
    visionFallback: pickBool('visionFallback'),

    debug: pickBool('debug')
  };

  Object.assign(patch, readStylePatchFromForm());

  keyFields.forEach(k => { patch[k] = pick(k); });

  return patch;
}

/* =========================
   Diagnostics (Ping/Self-test)
   ========================= */
function attachDiagnostics() {
  const pre = $('diag');
  const logLine = (...args) => {
    if (!pre) return;
    pre.textContent += args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n';
    pre.scrollTop = pre.scrollHeight;
  };

  const btnPing = $('btnPing');
  if (btnPing) {
    btnPing.onclick = async () => {
      if (pre) pre.textContent = '';
      try {
        const res = await api.runtime.sendMessage({ action: 'ping' });
        logLine('[ping]', res?.pong ? 'pong' : JSON.stringify(res));
      } catch (e) { logLine('[ping][error]', e.message || String(e)); }
    };
  }

  const btnSelfTest = $('btnSelfTest');
  if (btnSelfTest) {
    btnSelfTest.onclick = async () => {
      if (pre) pre.textContent = '';
      logLine('Running provider self-test ...');
      try {
        const res = await api.runtime.sendMessage({ action: 'selfTest' });
        if (res?.ok) logLine('[selfTest][ok]', JSON.stringify(res.result));
        else logLine('[selfTest][fail]', res?.error || JSON.stringify(res));
      } catch (e) { logLine('[selfTest][error]', e.message || String(e)); }
    };
  }

  const btnPE = $('openPromptEditor');
  if (btnPE) {
    btnPE.onclick = () => {
      const url = api.runtime.getURL('options/prompts.html');
      window.open(url, '_blank');
    };
  }
}

function codexSupportedInThisBuild() {
  const manifest = api.runtime?.getManifest?.() || {};
  return Array.isArray(manifest.optional_permissions)
    && manifest.optional_permissions.includes('nativeMessaging')
    && typeof api.runtime?.connectNative === 'function';
}

async function hasCodexPermission() {
  if (!codexSupportedInThisBuild() || typeof api.permissions?.contains !== 'function') return false;
  try {
    return await callApi(api.permissions.contains.bind(api.permissions), { permissions: ['nativeMessaging'] });
  } catch {
    return false;
  }
}

function setCodexStatus(key, fallback) {
  const status = $('codexProviderStatus');
  if (status) {
    status.dataset.statusI18n = key;
    status.textContent = t(key) === key ? fallback : t(key);
  }
}

async function checkCodexConnection() {
  const check = $('codexCheck');
  if (!codexSupportedInThisBuild()) {
    setCodexStatus('codexStatusUnavailable', 'Codex translation is unavailable in this browser build.');
    return;
  }
  if (!await hasCodexPermission()) {
    setCodexStatus('codexStatusPermission', 'Enable the local connection to use Codex.');
    return;
  }

  if (check) check.disabled = true;
  setCodexStatus('codexStatusConnecting', 'Checking the local Codex connection…');
  try {
    const response = await api.runtime.sendMessage({ action: 'codexStatus' });
    if (response?.ok && response.result?.service === 'ready') {
      setCodexStatus('codexStatusReady', 'The local Codex connection is ready. Your first translation will verify the current sign-in.');
    } else {
      setCodexStatus('codexStatusHostMissing', 'The Codex connection is not installed or needs an update.');
    }
  } catch {
    setCodexStatus('codexStatusHostMissing', 'The Codex connection is not installed or needs an update.');
  } finally {
    if (check) check.disabled = false;
  }
}

function attachCodexControls() {
  const provider = $('provider');
  const panel = $('codexProviderPanel');
  const setup = $('codexSetup');
  const enable = $('codexEnable');
  const check = $('codexCheck');
  const modelMode = $('codexModelMode');
  const modelField = $('codexModelCustomField');
  const modelInput = $('codexModel');
  if (!provider || !panel || !setup || !enable || !check || !modelMode || !modelField || !modelInput) return;

  const renderModel = (selected = provider.value === 'codex') => {
    const custom = modelMode.value === 'custom';
    modelField.hidden = !custom;
    modelInput.disabled = !selected || !custom;
    modelInput.required = selected && custom;
  };

  const render = () => {
    const selected = provider.value === 'codex';
    panel.hidden = !selected;
    renderModel(selected);
    if (!selected) return;
    const supported = codexSupportedInThisBuild();
    enable.hidden = !supported;
    check.hidden = !supported;
    checkCodexConnection();
  };

  provider.addEventListener('change', render);
  modelMode.addEventListener('change', () => renderModel());
  setup.addEventListener('click', () => {
    window.open(api.runtime.getURL('pages/codex_setup.html'), '_blank', 'noopener');
  });
  enable.addEventListener('click', async () => {
    enable.disabled = true;
    const granted = await requestCodexNativePermission();
    enable.disabled = false;
    if (!granted) {
      setCodexStatus('codexStatusDenied', 'The local connection permission was not enabled.');
      return;
    }
    await checkCodexConnection();
  });
  check.addEventListener('click', checkCodexConnection);
  render();
}

/* =========================
   Tabs Logic
   ========================= */
function attachTabs() {
  const btns = Array.from(document.querySelectorAll('.tab-btn'));
  const tabs = Array.from(document.querySelectorAll('.tab-content'));

  const activate = (activeBtn, { focus = false } = {}) => {
    btns.forEach(btn => {
      const selected = btn === activeBtn;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });

    tabs.forEach(tab => {
      const selected = tab.id === activeBtn.getAttribute('data-target');
      tab.classList.toggle('active', selected);
      tab.hidden = !selected;
    });

    if (focus) activeBtn.focus();
  };

  btns.forEach(btn => {
    if (btn.dataset.tabsBound === 'true') return;
    btn.dataset.tabsBound = 'true';
    btn.addEventListener('click', () => activate(btn));
    btn.addEventListener('keydown', event => {
      const current = btns.indexOf(btn);
      let next = current;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + btns.length) % btns.length;
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % btns.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = btns.length - 1;
      else return;

      event.preventDefault();
      activate(btns[next], { focus: true });
    });
  });

  const initial = btns.find(btn => btn.classList.contains('active')) || btns[0];
  if (initial) activate(initial);
}

/* =========================
   Init page
   ========================= */
(async function init() {
  attachTabs();

  try {
    const s = await getSettings();

    await initI18n(s.uiLang || 'en');
    applyI18n();

    const providerSelect = $('provider');
    if (providerSelect) {
      const chromeAi = getProviderDefinition('chrome-ai');
      const opt = document.createElement('option');
      opt.value = chromeAi.id;
      opt.textContent = chromeAi.label;

      try {
        const chromeAiStatus = await ChromeAiTranslate.getAvailability();
        if (chromeAiStatus === 'downloading') {
          opt.textContent += ' — downloading';
          opt.disabled = true;
        } else if (chromeAiStatus === 'unavailable') {
          opt.textContent += ' — unavailable';
          opt.disabled = true;
        }
      } catch (err) {
        opt.textContent += ' — unavailable';
        opt.disabled = true;
        console.warn('[options] Chrome AI availability check skipped:', err);
      }

      providerSelect.appendChild(opt);
    }

    document.querySelector('#provider option[value="openai-compat"]')?.remove();

    const setVal = (id, v) => { const el = $(id); if (el) el.value = (v ?? ''); };
    const setChk = (id, v) => { const el = $(id); if (el) el.checked = !!v; };

    setVal('provider', (s.provider === 'openai-compat') ? 'openai' : (s.provider || 'openai'));
    const codexModel = normalizeCodexModel(s.codexModel);
    setVal('codexModelMode', codexModel ? 'custom' : 'automatic');
    setVal('codexModel', codexModel);
    attachCodexControls();
    setVal('sourceLang', s.sourceLang || 'auto');
    setVal('targetLang', s.targetLang || 'zh');
    setChk('enableWordDictionary', !!s.enableWordDictionary);

    setVal('translationFontFamily', s.translationFontFamily || STYLE_DEFAULTS.translationFontFamily);
    setVal('translationFontSize', s.translationFontSize || STYLE_DEFAULTS.translationFontSize);
    setVal('translationTheme', safeTranslationTheme(s.translationTheme));
    const initialThemeMode = s.translationThemeMode === 'auto' && hasCustomStyleColors(s)
      ? 'custom'
      : (s.translationThemeMode || STYLE_DEFAULTS.translationThemeMode);
    setVal('translationThemeMode', initialThemeMode);
    syncColorPair('translationTextColor', s.translationTextColor || STYLE_DEFAULTS.translationTextColor);
    syncColorPair('translationBubbleColor', s.translationBubbleColor || STYLE_DEFAULTS.translationBubbleColor);
    syncColorPair('translationBorderColor', s.translationBorderColor || STYLE_DEFAULTS.translationBorderColor);
    attachStyleControls();
    updateStylePreview();

    setVal('uiLang', s.uiLang || 'en');
    setVal('ytPrefer', s.ytPreferBuiltIn ? 'builtin' : 'api');
    setChk('ytBilingualOverlay', !!s.ytBilingualOverlay);

    setChk('ocrEnabled', !!s.ocrEnabled);
    setVal('ocrLangs', s.ocrLangs || 'eng');
    setVal('ocrEngine', s.ocrEngine || 'tesseract');
    setChk('visionFallback', !!s.visionFallback);

    setChk('debug', !!s.debug);

    renderKeysForm(s);

    attachDiagnostics();

    // Real-time Save Setup
    let _saveTimeout;
    const triggerSave = (e) => {
      if (e.target && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') return;
      clearTimeout(_saveTimeout);
      _saveTimeout = setTimeout(async () => {
        try {
          const codexModelInput = $('codexModel');
          const patch = readPatchFromForm();
          const customCodexModel = $('codexModelMode')?.value === 'custom';
          const invalidCustomModel = customCodexModel
            && !normalizeCodexModel(codexModelInput?.value);
          if (invalidCustomModel) {
            if ($('provider')?.value === 'codex') {
              codexModelInput?.reportValidity?.();
              return;
            }
            // Leaving Codex must not turn an invalid draft into Automatic.
            // Save the unrelated fields and preserve the last valid model.
            delete patch.codexModel;
          }
          await setSettings(patch);
          await initI18n(patch.uiLang || 'en');
          applyI18n();
          updateStylePreview();
        } catch (e) {
          console.error('[options] auto-save failed:', e);
        }
      }, 400);
    };

    document.body.addEventListener('input', triggerSave);
    document.body.addEventListener('change', triggerSave);

  } catch (err) {
    console.error('[options] init failed:', err);
    const keysDiv = $('keys');
    if (keysDiv) {
      const msg = errorMessage(err);
      keysDiv.innerHTML = `
        <div class="col-span-1 md:col-span-2 rounded-xl border border-red-200/60 dark:border-red-900/60 p-4 bg-red-50/50 dark:bg-red-900/20">
          <div class="text-sm font-medium text-red-600 dark:text-red-400">Failed to load settings: ${escHtml(msg)}</div>
        </div>`;
    }
  }
})();
