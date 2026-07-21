import { providerSupports } from '../providers/catalog.js';

export function shouldUseDictionary({ providerId, probablyWord, enabled }) {
  return Boolean(
    probablyWord &&
    enabled &&
    providerSupports(providerId, 'dictionary')
  );
}
