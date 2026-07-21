let M = {}; let cur = 'en';
function norm(l){ return (l||'').toLowerCase().split('-')[0] || 'en'; }
export async function initI18n(pref){
  const api = globalThis.browser ?? globalThis.chrome;
  const fallback = norm(api?.i18n?.getUILanguage?.() || navigator.language);
  const list = [pref, fallback, 'en'].filter(Boolean).map(norm);
  for (const loc of list) {
    try {
      const url = api.runtime.getURL(`_locales/${loc}/messages.json`);
      const res = await fetch(url);
      if (res.ok){ M = await res.json(); cur = loc; return cur; }
    } catch {}
  }
  M = {}; cur = 'en'; return cur;
}
export function t(key, placeholders=[]) {
  const m = M?.[key]?.message || '';
  if (!m) return key;
  return placeholders.reduce((s, v, i)=> s.replace(new RegExp(`\$\{${i}\}`, 'g'), v), m);
}
export function currentLocale(){ return cur; }
