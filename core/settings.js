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
  return new Promise(resolve => {
    (chrome ?? browser).storage.sync.get(DEFAULTS, resolve);
  });
}

export async function setSettings(patch) {
  return new Promise(resolve => {
    (chrome ?? browser).storage.sync.set(patch, resolve);
  });
}
