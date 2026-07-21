import assert from 'node:assert/strict';
import test from 'node:test';

function createStorageArea(initial = {}) {
  const data = { ...initial };

  return {
    data,
    async get(query) {
      if (query == null) return { ...data };
      if (Array.isArray(query)) {
        return Object.fromEntries(query.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
      }
      if (typeof query === 'string') {
        return Object.hasOwn(data, query) ? { [query]: data[query] } : {};
      }
      return Object.fromEntries(Object.entries(query).map(([key, fallback]) => [
        key,
        Object.hasOwn(data, key) ? data[key] : fallback
      ]));
    },
    async set(patch) {
      Object.assign(data, patch);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
    }
  };
}

const sync = createStorageArea({
  provider: 'openai-compat',
  targetLang: 'fr',
  openaiKey: 'legacy-openai',
  azureKey: 'legacy-azure',
  compatKey: 'legacy-compatible-key',
  compatBaseUrl: 'https://compatible.example/v1',
  compatModel: 'compatible-model'
});
const local = createStorageArea({
  azureKey: 'local-azure',
  geminiKey: 'local-gemini'
});

globalThis.browser = {
  runtime: {},
  storage: { sync, local }
};

const {
  SECRET_SETTING_KEYS,
  getSettings,
  setSettings
} = await import('../core/settings.js');

test('legacy synchronized secrets migrate to local storage without overwriting local values', async () => {
  const settings = await getSettings();

  assert.equal(settings.targetLang, 'fr');
  assert.equal(settings.provider, 'openai');
  assert.equal(settings.openaiKey, 'legacy-compatible-key');
  assert.equal(settings.openaiBaseUrl, 'https://compatible.example/v1');
  assert.equal(settings.openaiModel, 'compatible-model');
  assert.equal(settings.azureKey, 'local-azure');
  assert.equal(settings.geminiKey, 'local-gemini');
  assert.equal(settings.openaiPromptTranslateUser, '');
  assert.equal(settings.ytBilingualOverlay, true);
  assert.equal(settings.translationTheme, 'none');
  assert.equal(settings.codexModel, '');

  assert.equal(local.data.openaiKey, 'legacy-compatible-key');
  assert.equal(local.data.azureKey, 'local-azure');
  assert.equal(local.data.geminiKey, 'local-gemini');
  for (const key of SECRET_SETTING_KEYS) assert.equal(Object.hasOwn(sync.data, key), false);
  assert.equal(sync.data.provider, 'openai');
  assert.equal(sync.data.openaiBaseUrl, 'https://compatible.example/v1');
  assert.equal(sync.data.openaiModel, 'compatible-model');

  const secondRead = await getSettings();
  assert.equal(secondRead.provider, 'openai');
  assert.equal(secondRead.openaiKey, 'legacy-compatible-key');
  assert.equal(secondRead.openaiBaseUrl, 'https://compatible.example/v1');
  assert.equal(secondRead.openaiModel, 'compatible-model');
  assert.equal(secondRead.azureKey, 'local-azure');
});

test('new secret values stay local while ordinary preferences remain synchronized', async () => {
  await setSettings({
    openaiKey: 'new-openai',
    targetLang: 'de',
    azureRegion: 'westeurope',
    translationTheme: 'highlight',
    codexModel: '  gpt-5-codex  '
  });

  assert.equal(local.data.openaiKey, 'new-openai');
  assert.equal(sync.data.targetLang, 'de');
  assert.equal(sync.data.azureRegion, 'westeurope');
  assert.equal(sync.data.translationTheme, 'highlight');
  assert.equal(sync.data.codexModel, 'gpt-5-codex');
  assert.equal(Object.hasOwn(local.data, 'codexModel'), false);
  assert.equal(Object.hasOwn(sync.data, 'openaiKey'), false);

  const settings = await getSettings();
  assert.equal(settings.openaiKey, 'new-openai');
  assert.equal(settings.targetLang, 'de');
  assert.equal(settings.azureRegion, 'westeurope');
  assert.equal(settings.translationTheme, 'highlight');
  assert.equal(settings.codexModel, 'gpt-5-codex');

  sync.data.codexModel = `bad\u0000model`;
  assert.equal((await getSettings()).codexModel, '');

  sync.data.codexModel = 'gpt-5-codex';
  await assert.rejects(
    setSettings({ codexModel: '   ' }),
    error => error?.code === 'CODEX_INVALID_MODEL'
  );
  await assert.rejects(
    setSettings({ codexModel: '--invalid-model' }),
    error => error?.code === 'CODEX_INVALID_MODEL'
  );
  assert.equal(sync.data.codexModel, 'gpt-5-codex');

  await setSettings({ codexModel: '' });
  assert.equal(sync.data.codexModel, '');
});
