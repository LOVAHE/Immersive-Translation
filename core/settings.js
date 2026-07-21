import { api, callApi } from './browser.js';

export const SECRET_SETTING_KEYS = Object.freeze([
  'googleApiKey',
  'azureKey',
  'deeplKey',
  'openaiKey',
  'geminiKey',
  'compatKey'
]);

const SYNC_DEFAULTS = {
  provider: 'openai',
  targetLang: 'zh',
  sourceLang: 'auto',
  uiLang: 'en',
  enableWordDictionary: true,
  onboardingComplete: false,

  ytPreferBuiltIn: true,
  ytBilingualOverlay: true,

  ocrEnabled: true,
  ocrEngine: 'tesseract',
  ocrLangs: 'eng',
  visionFallback: true,

  translationFontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif',
  translationFontSize: '14',
  translationTheme: 'none',
  translationThemeMode: 'auto',
  translationTextColor: '#0f172a',
  translationBubbleColor: '#ffffff',
  translationBorderColor: '#e2e8f0',

  azureRegion: '',
  codexModel: '',
  openaiModel: 'gpt-5-mini',
  openaiBaseUrl: 'https://api.openai.com/v1',
  geminiModel: 'gemini-2.5-flash',
  openaiPromptTranslateSystem: '',
  openaiPromptTranslateUser: '',
  openaiPromptDictSystem: '',
  openaiPromptDictUser: '',
  compatBaseUrl: '',
  compatModel: '',

  debug: false
};

function splitSettingsPatch(patch = {}) {
  const syncPatch = {};
  const localPatch = {};

  for (const [key, value] of Object.entries(patch)) {
    if (SECRET_SETTING_KEYS.includes(key)) localPatch[key] = value;
    else syncPatch[key] = value;
  }

  return { syncPatch, localPatch };
}

function nonEmptyString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const CODEX_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function normalizeCodexModel(value) {
  if (typeof value !== 'string') return '';
  const model = value.trim();
  return CODEX_MODEL_PATTERN.test(model) ? model : '';
}

function validateCodexModelForWrite(value) {
  if (value === '') return '';

  const model = typeof value === 'string' ? value.trim() : '';
  if (!model || !CODEX_MODEL_PATTERN.test(model)) {
    const error = new Error('Codex model must be empty for Automatic, or a valid model ID.');
    error.code = 'CODEX_INVALID_MODEL';
    throw error;
  }
  return model;
}

function buildLegacyCompatMigration(settings) {
  if (settings.provider !== 'openai-compat') return null;

  const syncPatch = { provider: 'openai' };
  const localPatch = {};
  const compatBaseUrl = nonEmptyString(settings.compatBaseUrl);
  const compatModel = nonEmptyString(settings.compatModel);
  const compatKey = nonEmptyString(settings.compatKey);

  if (compatBaseUrl) syncPatch.openaiBaseUrl = compatBaseUrl;
  if (compatModel) syncPatch.openaiModel = compatModel;
  if (compatKey) localPatch.openaiKey = compatKey;

  return {
    syncPatch,
    localPatch,
    settings: { ...settings, ...syncPatch, ...localPatch }
  };
}

async function migrateLegacyCompatSettings(settings) {
  const migration = buildLegacyCompatMigration(settings);
  if (!migration) return settings;

  // Persist the secret first. If that write fails, the legacy provider marker
  // remains in sync storage and the whole migration is retried on the next read.
  if (Object.keys(migration.localPatch).length) {
    await callApi(api.storage.local.set.bind(api.storage.local), migration.localPatch);
  }
  await callApi(api.storage.sync.set.bind(api.storage.sync), migration.syncPatch);

  return migration.settings;
}

async function readAndMigrateSecrets() {
  const [localSecrets, legacySyncSecrets] = await Promise.all([
    callApi(api.storage.local.get.bind(api.storage.local), SECRET_SETTING_KEYS),
    callApi(api.storage.sync.get.bind(api.storage.sync), SECRET_SETTING_KEYS)
  ]);
  const effectiveSecrets = {};
  const migrationPatch = {};
  const legacyKeys = [];

  for (const key of SECRET_SETTING_KEYS) {
    const hasLocal = Object.hasOwn(localSecrets, key);
    const hasLegacy = Object.hasOwn(legacySyncSecrets, key);
    effectiveSecrets[key] = hasLocal
      ? localSecrets[key]
      : (hasLegacy ? legacySyncSecrets[key] : '');

    if (!hasLocal && hasLegacy) migrationPatch[key] = legacySyncSecrets[key];
    if (hasLegacy) legacyKeys.push(key);
  }

  if (Object.keys(migrationPatch).length) {
    await callApi(api.storage.local.set.bind(api.storage.local), migrationPatch);
  }
  if (legacyKeys.length) {
    await callApi(api.storage.sync.remove.bind(api.storage.sync), legacyKeys);
  }

  return effectiveSecrets;
}

export async function getSettings() {
  const [syncSettings, secrets] = await Promise.all([
    callApi(api.storage.sync.get.bind(api.storage.sync), SYNC_DEFAULTS),
    readAndMigrateSecrets()
  ]);
  const settings = await migrateLegacyCompatSettings({ ...syncSettings, ...secrets });
  return { ...settings, codexModel: normalizeCodexModel(settings.codexModel) };
}

export async function setSettings(patch = {}) {
  const normalizedPatch = Object.hasOwn(patch, 'codexModel')
    ? { ...patch, codexModel: validateCodexModelForWrite(patch.codexModel) }
    : patch;
  const { syncPatch, localPatch } = splitSettingsPatch(normalizedPatch);
  const secretKeys = Object.keys(localPatch);

  if (secretKeys.length) {
    await callApi(api.storage.local.set.bind(api.storage.local), localPatch);
    await callApi(api.storage.sync.remove.bind(api.storage.sync), secretKeys);
  }
  if (Object.keys(syncPatch).length) {
    await callApi(api.storage.sync.set.bind(api.storage.sync), syncPatch);
  }
}
