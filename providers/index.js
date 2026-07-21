// providers/index.js

import { GoogleTranslate } from './googleTranslate.js';
import { AzureTranslate } from './azureTranslate.js';
import { DeepLTranslate } from './deepl.js';
import { OpenAIChatTranslate } from './openai.js';
import { GeminiTranslate } from './gemini.js';
import { ChromeAiTranslate } from './chromeAi.js';
import { CodexTranslate } from './codex.js';
import { resolveProviderId } from './catalog.js';

export function getProvider(id, settings = {}) {
  switch (resolveProviderId(id)) {
    case 'codex':
      return new CodexTranslate({
        model: settings.codexModel,
        promptTranslateSystem: settings.openaiPromptTranslateSystem,
        promptTranslateUser: settings.openaiPromptTranslateUser
      });
    case 'chrome-ai':
      return new ChromeAiTranslate({
        promptTranslateSystem: settings.openaiPromptTranslateSystem,
        promptTranslateUser:   settings.openaiPromptTranslateUser,
        promptDictSystem:      settings.openaiPromptDictSystem,
        promptDictUser:        settings.openaiPromptDictUser
      });
    case 'google':
      return new GoogleTranslate({ apiKey: settings.googleApiKey });
    case 'azure':
      return new AzureTranslate({ key: settings.azureKey, region: settings.azureRegion, endpoint: settings.azureEndpoint });
    case 'deepl':
      return new DeepLTranslate({ key: settings.deeplKey });
    case 'gemini':
      return new GeminiTranslate({
        apiKey: settings.geminiKey,
        model: settings.geminiModel || 'gemini-2.5-flash',
        promptTranslateSystem: settings.openaiPromptTranslateSystem,
        promptTranslateUser:   settings.openaiPromptTranslateUser,
        promptDictSystem:      settings.openaiPromptDictSystem,
        promptDictUser:        settings.openaiPromptDictUser
      });
    case 'openai':
      return new OpenAIChatTranslate({
        apiKey: settings.openaiKey,
        baseUrl: settings.openaiBaseUrl,  // leave empty to use official
        model:   settings.openaiModel || 'gpt-5-mini',
        promptTranslateSystem: settings.openaiPromptTranslateSystem,
        promptTranslateUser:   settings.openaiPromptTranslateUser,
        promptDictSystem:      settings.openaiPromptDictSystem,
        promptDictUser:        settings.openaiPromptDictUser,
        jsonModeSupported: true
      });
  }
}
