// options/options.js

import { getSettings, setSettings } from '../core/settings.js';
import { initI18n, t } from '../core/i18n.js';
import { ChromeAiTranslate } from '../providers/chromeAi.js';

const api = (globalThis.browser ?? globalThis.chrome);

const keyFields = [
  'googleApiKey',
  'azureKey', 'azureRegion',
  'deeplKey',
  'openaiKey', 'openaiBaseUrl', 'openaiModel',
  'geminiKey', 'geminiModel'
];

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
  translationThemeMode: 'auto',
  translationTextColor: '#0f172a',
  translationBubbleColor: '#ffffff',
  translationBorderColor: '#e2e8f0'
};
const MIN_TEXT_CONTRAST = 4.5;
const PRESET_THEMES = {
  light: { textColor: '#0f172a', bubbleColor: '#ffffff', borderColor: '#e2e8f0' },
  dark: { textColor: '#e5edf5', bubbleColor: '#111827', borderColor: '#334155' }
};

/* =========================
   Helpers & i18n
   ========================= */
function $(id) { return document.getElementById(id); }

function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    if (k) el.textContent = t(k);
  });
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
      <input id="${safeId}" class="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131315] px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none transition-all duration-200"
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

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const channel = (value) => {
    const n = value / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  if (l1 == null || l2 == null) return Number.POSITIVE_INFINITY;
  const high = Math.max(l1, l2);
  const low = Math.min(l1, l2);
  return (high + 0.05) / (low + 0.05);
}

function readableTextColor(textColor, bubbleColor) {
  if (contrastRatio(textColor, bubbleColor) >= MIN_TEXT_CONTRAST) return textColor;
  const dark = '#111827';
  const light = '#f8fafc';
  return contrastRatio(light, bubbleColor) >= contrastRatio(dark, bubbleColor) ? light : dark;
}

function safeThemeMode(value) {
  return ['auto', 'light', 'dark', 'custom'].includes(value) ? value : STYLE_DEFAULTS.translationThemeMode;
}

function hasCustomStyleColors(s = {}) {
  return [
    ['translationTextColor', STYLE_DEFAULTS.translationTextColor],
    ['translationBubbleColor', STYLE_DEFAULTS.translationBubbleColor],
    ['translationBorderColor', STYLE_DEFAULTS.translationBorderColor]
  ].some(([key, fallback]) => isHexColor(s[key]) && String(s[key]).toLowerCase() !== fallback.toLowerCase());
}

function pageLooksDark() {
  const bg = getComputedStyle(document.body).backgroundColor;
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(bg);
  if (!match) return false;
  const hex = `#${[match[1], match[2], match[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('')}`;
  const lum = relativeLuminance(hex);
  return lum != null && lum < 0.45;
}

function resolvePreviewColors(style) {
  const mode = safeThemeMode(style.translationThemeMode);
  if (mode === 'custom') {
    return {
      textColor: readableTextColor(style.translationTextColor, style.translationBubbleColor),
      bubbleColor: style.translationBubbleColor,
      borderColor: style.translationBorderColor
    };
  }
  const preset = mode === 'dark' || (mode === 'auto' && pageLooksDark()) ? PRESET_THEMES.dark : PRESET_THEMES.light;
  return preset;
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
  const colors = resolvePreviewColors(style);
  updateStyleControlsState();
  preview.style.fontFamily = style.translationFontFamily;
  preview.style.fontSize = `${style.translationFontSize}px`;
  preview.style.color = colors.textColor;
  preview.style.backgroundColor = colors.bubbleColor;
  preview.style.borderColor = colors.borderColor;
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
  ['translationFontFamily', 'translationFontSize', 'translationThemeMode'].forEach(id => {
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

/* =========================
   Tabs Logic
   ========================= */
function attachTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  const tabs = document.querySelectorAll('.tab-content');

  btns.forEach(btn => {
    if (btn.dataset.tabsBound === 'true') return;
    btn.dataset.tabsBound = 'true';
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      tabs.forEach(t => t.classList.remove('active'));
      
      btn.classList.add('active');
      const targetId = btn.getAttribute('data-target');
      const target = document.getElementById(targetId);
      if (target) target.classList.add('active');
    });
  });
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

    try {
      const chromeAiStatus = await ChromeAiTranslate.getAvailability();
      const providerSelect = $('provider');
      if (chromeAiStatus !== 'unavailable' && providerSelect) {
        const opt = document.createElement('option');
        opt.value = 'chrome-ai';
        opt.textContent = 'Chrome AI (Local)';
        if (chromeAiStatus === 'downloading') {
          opt.textContent += ' (downloading...)';
          opt.disabled = true;
        }
        providerSelect.appendChild(opt);
      }
    } catch (err) {
      console.warn('[options] Chrome AI availability check skipped:', err);
    }

    document.querySelector('#provider option[value="openai-compat"]')?.remove();

    const setVal = (id, v) => { const el = $(id); if (el) el.value = (v ?? ''); };
    const setChk = (id, v) => { const el = $(id); if (el) el.checked = !!v; };

    setVal('provider', (s.provider === 'openai-compat') ? 'openai' : (s.provider || 'openai'));
    setVal('sourceLang', s.sourceLang || 'auto');
    setVal('targetLang', s.targetLang || 'zh');
    setChk('enableWordDictionary', !!s.enableWordDictionary);

    setVal('translationFontFamily', s.translationFontFamily || STYLE_DEFAULTS.translationFontFamily);
    setVal('translationFontSize', s.translationFontSize || STYLE_DEFAULTS.translationFontSize);
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
          const patch = readPatchFromForm();
          await setSettings(patch);
          await initI18n(patch.uiLang || 'en');
          applyI18n();
          updateStylePreview();
          console.log('[options] auto-save OK');
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
