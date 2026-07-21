import { initI18n, t } from '../core/i18n.js';
import { getSettings } from '../core/settings.js';

const api = globalThis.browser ?? globalThis.chrome;
const extensionId = api.runtime.id;
const browserName = navigator.userAgent.includes('Edg/') ? 'Edge' : 'Chrome';
const extensionIdElement = document.getElementById('extension-id');
const commandElement = document.getElementById('install-command');
const copyButton = document.getElementById('copy-id');
const copyStatus = document.getElementById('copy-status');

function message(key, fallback) {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

function localize() {
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const translated = t(element.dataset.i18n);
    if (translated !== element.dataset.i18n) element.textContent = translated;
  });
}

async function start() {
  const settings = await getSettings();
  document.documentElement.lang = await initI18n(settings.uiLang || 'en');
  localize();
  extensionIdElement.textContent = extensionId;
  commandElement.textContent = `powershell -ExecutionPolicy Bypass -File .\\install-windows.ps1 -Browser ${browserName} -ExtensionId ${extensionId} -Login`;
}

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(extensionId);
    copyStatus.textContent = message('codexSetupCopied', 'Extension ID copied.');
  } catch {
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(extensionIdElement);
    selection.removeAllRanges();
    selection.addRange(range);
    copyStatus.textContent = message('codexSetupSelect', 'Copy the selected extension ID.');
  }
});

start();
