const DEFINITIONS = Object.freeze({
  codex: Object.freeze({
    id: 'codex',
    label: 'Codex (Experimental)',
    experimental: true,
    capabilities: Object.freeze({ dictionary: false, vision: false })
  }),
  openai: Object.freeze({
    id: 'openai',
    label: 'OpenAI',
    experimental: false,
    capabilities: Object.freeze({ dictionary: true, vision: false })
  }),
  google: Object.freeze({
    id: 'google',
    label: 'Google Translate',
    experimental: false,
    capabilities: Object.freeze({ dictionary: false, vision: false })
  }),
  azure: Object.freeze({
    id: 'azure',
    label: 'Azure Translator',
    experimental: false,
    capabilities: Object.freeze({ dictionary: true, vision: false })
  }),
  deepl: Object.freeze({
    id: 'deepl',
    label: 'DeepL',
    experimental: false,
    capabilities: Object.freeze({ dictionary: false, vision: false })
  }),
  gemini: Object.freeze({
    id: 'gemini',
    label: 'Gemini',
    experimental: false,
    capabilities: Object.freeze({ dictionary: true, vision: true })
  }),
  'chrome-ai': Object.freeze({
    id: 'chrome-ai',
    label: 'Chrome AI (Experimental)',
    experimental: true,
    capabilities: Object.freeze({ dictionary: true, vision: true })
  })
});

export function resolveProviderId(id) {
  const candidate = String(id || '').trim();
  return Object.hasOwn(DEFINITIONS, candidate) ? candidate : 'openai';
}

export function getProviderDefinition(id) {
  return DEFINITIONS[resolveProviderId(id)];
}

export function providerSupports(id, capability) {
  return getProviderDefinition(id).capabilities[capability] === true;
}

export function listProviderDefinitions() {
  return Object.values(DEFINITIONS);
}
