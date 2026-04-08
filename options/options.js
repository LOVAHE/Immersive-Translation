// options/options.js

import { getSettings, setSettings } from '../core/settings.js';
import { initI18n, t } from '../core/i18n.js';
import { ChromeAiTranslate } from '../providers/chromeAi.js';

const api = (globalThis.chrome ?? globalThis.browser);

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

function renderKeysForm(s) {
  const keysDiv = $('keys');
  if (!keysDiv) return;
  keysDiv.innerHTML = '';

  const frag = document.createDocumentFragment();
  const mkRow = (id, label, placeholder, value) => {
    const wrap = document.createElement('div');
    wrap.className = 'block space-y-2';
    wrap.innerHTML = `
      <label class="block text-sm font-semibold text-slate-700 dark:text-slate-300" for="${id}">${label}</label>
      <input id="${id}" class="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#131315] px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none transition-all duration-200"
             placeholder="${placeholder || ''}" value="${value ? String(value) : ''}">
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
      const url = (chrome ?? browser).runtime.getURL('options/prompts.html');
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
  try {
    const s = await getSettings();

    await initI18n(s.uiLang || 'en');
    applyI18n();

    // Add Chrome AI provider if available
    const chromeAiStatus = await ChromeAiTranslate.getAvailability();
    if (chromeAiStatus !== 'unavailable') {
      const providerSelect = $('provider');
      const opt = document.createElement('option');
      opt.value = 'chrome-ai';
      opt.textContent = 'Chrome AI (Local)';
      if (chromeAiStatus === 'downloading') {
        opt.textContent += ' (downloading...)';
        opt.disabled = true;
      }
      providerSelect.appendChild(opt);
    }

    document.querySelector('#provider option[value="openai-compat"]')?.remove();

    const setVal = (id, v) => { const el = $(id); if (el) el.value = (v ?? ''); };
    const setChk = (id, v) => { const el = $(id); if (el) el.checked = !!v; };

    setVal('provider', (s.provider === 'openai-compat') ? 'openai' : (s.provider || 'openai'));
    setVal('sourceLang', s.sourceLang || 'auto');
    setVal('targetLang', s.targetLang || 'zh');
    setChk('enableWordDictionary', !!s.enableWordDictionary);

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

    attachTabs();

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
      keysDiv.innerHTML = `
        <div class="col-span-1 md:col-span-2 rounded-xl border border-red-200/60 dark:border-red-900/60 p-4 bg-red-50/50 dark:bg-red-900/20">
          <div class="text-sm font-medium text-red-600 dark:text-red-400">Failed to load settings. See console for details.</div>
        </div>`;
    }
  }
})();
