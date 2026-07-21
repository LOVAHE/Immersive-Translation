import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Codex uses an optional Chrome native connection and stays unavailable in Firefox', async () => {
  const [main, chrome, firefox, bridge] = await Promise.all([
    readFile(new URL('../manifest.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../manifest.chrome.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../manifest.firefox.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../core/codexNative.js', import.meta.url), 'utf8')
  ]);

  assert.deepEqual(main.optional_permissions, ['nativeMessaging']);
  assert.deepEqual(chrome.optional_permissions, ['nativeMessaging']);
  assert.equal(firefox.optional_permissions, undefined);
  assert.match(bridge, /com\.adaptive_translation\.codex/);
  assert.match(bridge, /CODEX_NATIVE_PROTOCOL_VERSION\s*=\s*2/);
  assert.match(bridge, /method:\s*'cancel'/);
});

test('Codex settings surface requests permission from an explicit user action', async () => {
  const [html, options, setupHtml, setupScript] = await Promise.all([
    readFile(new URL('../options/options.html', import.meta.url), 'utf8'),
    readFile(new URL('../options/options.js', import.meta.url), 'utf8'),
    readFile(new URL('../pages/codex_setup.html', import.meta.url), 'utf8'),
    readFile(new URL('../pages/codex_setup.js', import.meta.url), 'utf8')
  ]);

  assert.match(html, /option value="codex"/);
  assert.match(html, /id="codexProviderStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="codexEnable"/);
  assert.match(options, /codexEnable/);
  assert.match(options, /requestCodexNativePermission/);
  assert.match(options, /runtime\.getURL\('pages\/codex_setup\.html'\)/);
  assert.match(setupHtml, /id="extension-id"/);
  assert.match(setupScript, /install-windows\.ps1/);
  assert.match(setupScript, /-Login/);
  assert.doesNotMatch(options, /setTimeout\([^)]*requestCodexNativePermission/);
});

test('Codex companion delivery is locked and built as a separate artifact', async () => {
  const [installer, login, logout, lock, build] = await Promise.all([
    readFile(new URL('../companion/install-windows.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../companion/login-windows.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../companion/logout-windows.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../companion/package-lock.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../tools/build-codex-companion.ps1', import.meta.url), 'utf8')
  ]);

  assert.match(installer, /npmPath ci --omit=dev --ignore-scripts/);
  assert.match(installer, /LOCALAPPDATA[^\n]+CodexCompanion/);
  assert.match(installer, /Installed companion files/);
  assert.match(login, /LOCALAPPDATA[^\n]+AdaptiveTranslation\\Codex/);
  assert.match(logout, /CodexCli logout/);
  assert.doesNotMatch(`${installer}\n${login}`, /Copy-Item[^\n]+auth|\.codex\\auth/i);
  assert.equal(lock.packages[''].dependencies['@openai/codex-sdk'], '0.144.5');
  assert.match(build, /Get-FileHash[^\n]+SHA256/);
  assert.match(build, /login-windows\.ps1/);

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const validation = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'tools', 'build-codex-companion.ps1'),
    '-ValidateOnly'
  ], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  assert.match(validation.stdout, /metadata is valid/i);
});

test('Codex setup copy is localized in every supported UI language', async () => {
  const locales = ['de', 'en', 'es', 'fr', 'ja', 'ko', 'zh'];
  const required = [
    'codexSetupButton',
    'codexSetupTitle',
    'codexSetupIntro',
    'codexSetupExtensionId',
    'codexSetupCopy',
    'codexSetupSteps',
    'codexSetupStepDownload',
    'codexSetupStepOpen',
    'codexSetupStepRun',
    'codexSetupStepReload',
    'codexSetupSecurity'
  ];
  for (const locale of locales) {
    const messages = JSON.parse(await readFile(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'));
    for (const key of required) assert.ok(messages[key]?.message, `${locale} is missing ${key}`);
  }
});
