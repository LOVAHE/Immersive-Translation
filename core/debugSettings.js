import { setDebugLogging } from './log.js';

export function applyDebugSettingChange(changes, areaName, apply = setDebugLogging) {
  if (areaName !== 'sync' || !changes || !Object.hasOwn(changes, 'debug')) {
    return false;
  }

  apply(changes.debug?.newValue === true);
  return true;
}
