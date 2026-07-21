import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

globalThis.browser = {
  runtime: { getURL: path => `extension://${path}` },
  storage: {
    sync: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    local: { get: async () => ({}), set: async () => {} }
  }
};

const { getOverlayBoxPercentages } = await import('../content/imageOverlay.js');

test('image overlay boxes use resize-safe percentages', () => {
  assert.deepEqual(getOverlayBoxPercentages([20, 10, 120, 60], 200, 100), {
    left: 10,
    top: 10,
    width: 50,
    height: 50
  });
  assert.equal(getOverlayBoxPercentages([0, 0, 0, 0], 200, 100), null);
});

test('options stylesheet declares a real dark color scheme', async () => {
  const css = await readFile(new URL('../options/options.css', import.meta.url), 'utf8');
  const darkBlock = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));

  assert.match(darkBlock, /color-scheme:\s*dark/);
  assert.match(darkBlock, /--page:\s*#0f0f10/);
  assert.match(darkBlock, /--panel:\s*#18181b/);
  assert.match(darkBlock, /--text:\s*#f8fafc/);
});

test('options exposes immersive paragraph themes with an accessible bilingual preview', async () => {
  const [html, css, js] = await Promise.all([
    readFile(new URL('../options/options.html', import.meta.url), 'utf8'),
    readFile(new URL('../options/options.css', import.meta.url), 'utf8'),
    readFile(new URL('../options/options.js', import.meta.url), 'utf8')
  ]);

  assert.match(html, /<select id="translationTheme"/);
  for (const theme of ['none', 'underline', 'dashed', 'highlight', 'weakening', 'mask', 'bold', 'italic']) {
    assert.match(html, new RegExp(`<option value="${theme}"`));
  }

  assert.match(html, /id="stylePreviewOriginal"/);
  assert.match(html, /id="stylePreviewTranslation"/);
  assert.match(html, /option value="codex"/);
  assert.match(html, /id="codexProviderStatus"[^>]*aria-live="polite"/);
  assert.match(html, /id="codexModelMode"[^>]*aria-describedby="codexModelHelp"/);
  assert.match(html, /option value="automatic"[^>]*data-i18n="codexModelAutomatic"/);
  assert.match(html, /id="codexModelCustomField"[^>]*hidden/);
  assert.match(html, /id="codexModel"[^>]*maxlength="128"[^>]*disabled/);
  assert.match(html, /id="codexModel"[^>]*pattern="\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{0,127\}"/);
  assert.match(js, /modelInput\.disabled\s*=\s*!selected\s*\|\|\s*!custom/);
  assert.match(js, /modelInput\.required\s*=\s*selected\s*&&\s*custom/);
  assert.match(js, /codexModel:\s*pick\('codexModelMode'\)\s*===\s*'custom'\s*\?\s*pick\('codexModel'\)/);
  assert.match(js, /invalidCustomModel[\s\S]*?delete patch\.codexModel/);
  assert.doesNotMatch(js, /codexModel:\s*pick\('codexModelMode'\)[\s\S]{0,100}normalizeCodexModel/);
  assert.doesNotMatch(html, /id="stylePreview"[^>]*(?:shadow|rounded|border)/);
  assert.doesNotMatch(html, /Immersive Translation|Adaptive Translation 2\.0/);

  assert.match(html, /id="tabs-nav"[^>]*role="tablist"/);
  assert.equal((html.match(/role="tab"/g) || []).length, 5);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 5);
  assert.match(js, /ArrowLeft/);
  assert.match(js, /ArrowRight/);
  assert.match(js, /aria-selected/);
  assert.match(css, /\.toggle-peer:focus-visible\s*~\s*\.toggle-track/);
  assert.match(css, /#stylePreview\[data-translation-theme="underline"\]/);
  assert.match(css, /#stylePreview\[data-translation-theme="mask"\]/);
});

test('every options i18n key is present in every locale', async () => {
  const html = await readFile(new URL('../options/options.html', import.meta.url), 'utf8');
  const keys = new Set(Array.from(
    html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g),
    match => match[1]
  ));

  for (const locale of ['de', 'en', 'es', 'fr', 'ja', 'ko', 'zh']) {
    const messages = JSON.parse(await readFile(new URL(`../_locales/${locale}/messages.json`, import.meta.url), 'utf8'));
    for (const key of keys) {
      assert.ok(messages[key]?.message, `${locale} is missing ${key}`);
    }
  }
});

test('web-accessible resources expose only the content-script module graph', async () => {
  for (const file of ['manifest.json', 'manifest.chrome.json', 'manifest.firefox.json']) {
    const manifest = JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
    const resources = manifest.web_accessible_resources.flatMap(entry => entry.resources || []);
    assert.deepEqual(resources, ['core/*.js', 'content/*.js', 'ocr/*.js', 'vendor/*']);
    assert.ok(!resources.some(resource => /^(?:pages|options|providers|prompts)\//.test(resource)));
  }
});
