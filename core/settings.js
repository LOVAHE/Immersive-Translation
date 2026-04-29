import { api, callApi } from './browser.js';

const DEFAULTS = {
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
  translationTextColor: '#0f172a',
  translationBubbleColor: '#ffffff',
  translationBorderColor: '#e2e8f0',

  googleApiKey: '',
  azureKey: '',
  azureRegion: '',
  deeplKey: '',
  openaiKey: '',
  openaiModel: 'gpt-5-mini',
  openaiBaseUrl: 'https://api.openai.com/v1',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  compatKey: '',
  compatBaseUrl: '',
  compatModel: '',

  debug: false
};

export async function getSettings() {
  return callApi(api.storage.sync.get.bind(api.storage.sync), DEFAULTS);
}

export async function setSettings(patch) {
  return callApi(api.storage.sync.set.bind(api.storage.sync), patch);
}
