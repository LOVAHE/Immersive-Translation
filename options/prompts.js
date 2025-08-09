import { getSettings, setSettings } from '../core/settings.js';
import { initI18n, t } from '../core/i18n.js';
import { buildTranslatePrompt, buildDictionaryPrompt } from '../prompts/common.js';

function el(id){ return document.getElementById(id); }
function applyI18n(root=document){ root.querySelectorAll('[data-i18n]').forEach(n=>{ n.textContent = t(n.getAttribute('data-i18n')); }); }

(async function init(){
  const s = await getSettings();
  await initI18n(s.uiLang || 'en'); applyI18n();

  el('openaiPromptTranslateSystem').value = s.openaiPromptTranslateSystem || '';
  el('openaiPromptTranslateUser').value   = s.openaiPromptTranslateUser || '';
  el('openaiPromptDictSystem').value      = s.openaiPromptDictSystem || '';
  el('openaiPromptDictUser').value        = s.openaiPromptDictUser || '';

  el('btnSave').onclick = async () => {
    await setSettings({
      openaiPromptTranslateSystem: el('openaiPromptTranslateSystem').value,
      openaiPromptTranslateUser:   el('openaiPromptTranslateUser').value,
      openaiPromptDictSystem:      el('openaiPromptDictSystem').value,
      openaiPromptDictUser:        el('openaiPromptDictUser').value
    });
    alert(t('btnSave') || 'Saved');
  };

  el('btnReset').onclick = async () => {
    const demoT = buildTranslatePrompt({ text:'Hello', targetLang:'zh' });
    const demoD = buildDictionaryPrompt({ text:'apple', targetLang:'zh' });
    el('openaiPromptTranslateSystem').value = demoT.systemText;
    el('openaiPromptTranslateUser').value   = demoT.userText.replace(/---[\\s\\S]*$/,'---\\n');
    el('openaiPromptDictSystem').value      = demoD.systemText;
    el('openaiPromptDictUser').value        = demoD.userText.replace(/WORD:[\\s\\S]*/,'WORD:\\nTARGET:\\nSOURCE:');
  };
})();
