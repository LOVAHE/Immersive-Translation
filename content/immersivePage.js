const STYLE_ID = 'it-immersive-page-style';
const SOURCE_ATTRIBUTE = 'data-it-translation-source';
const TARGET_ATTRIBUTE = 'data-it-translation-target';
const TARGET_SELECTOR = `[${TARGET_ATTRIBUTE}="true"]`;

const THEMES = new Set([
  'none',
  'underline',
  'dashed',
  'highlight',
  'weakening',
  'mask',
  'bold',
  'italic'
]);

let mountedRecords = new WeakMap();

export const IMMERSIVE_PAGE_CSS = `
:root {
  --immersive-translate-theme-underline-borderColor: #72ece9;
  --immersive-translate-theme-dashed-borderColor: #59c1bd;
  --immersive-translate-theme-highlight-backgroundColor: #ffff00;
}

.immersive-translate-target-wrapper {
  box-sizing: border-box !important;
  max-width: 100% !important;
  font: inherit !important;
  line-height: inherit !important;
  letter-spacing: inherit !important;
  text-align: inherit !important;
  color: inherit !important;
  font-feature-settings: normal;
}

.immersive-translate-target-wrapper,
.immersive-translate-target-wrapper * {
  box-sizing: border-box !important;
}

[imt-state="translation"] .immersive-translate-target-wrapper > br {
  display: none !important;
}

[imt-state="dual"] .immersive-translate-target-translation-block-wrapper {
  display: inline-block !important;
  max-width: 100% !important;
  margin: 8px 0 !important;
  padding: 0 !important;
  font: inherit !important;
  line-height: inherit !important;
  letter-spacing: inherit !important;
  text-align: inherit !important;
  color: inherit !important;
  white-space: normal !important;
  overflow-wrap: anywhere !important;
}

[imt-state="translation"] .immersive-translate-target-translation-block-wrapper {
  display: inline-block !important;
  margin: 0 !important;
}

.immersive-translate-target-translation-inline-wrapper {
  display: inline !important;
  margin: 0 !important;
  padding: 0 !important;
  font: inherit !important;
  line-height: inherit !important;
  letter-spacing: inherit !important;
  text-align: inherit !important;
  color: inherit !important;
  white-space: normal !important;
  overflow-wrap: anywhere !important;
}

.immersive-translate-target-inline-spacer {
  font: inherit !important;
  white-space: pre !important;
}

.immersive-translate-target-inner {
  font: inherit !important;
  line-height: inherit !important;
  letter-spacing: inherit !important;
  text-align: inherit !important;
  color: inherit !important;
}

[imt-state="dual"] .immersive-translate-target-translation-theme-underline-inner {
  border-bottom: 1px solid var(--immersive-translate-theme-underline-borderColor) !important;
}

[imt-state="dual"] .immersive-translate-target-translation-theme-dashed-inner {
  border-bottom: 1px dashed var(--immersive-translate-theme-dashed-borderColor) !important;
}

[imt-state="dual"] .immersive-translate-target-translation-theme-highlight-inner {
  background: var(--immersive-translate-theme-highlight-backgroundColor) !important;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

[imt-state="dual"] .immersive-translate-target-translation-theme-weakening {
  opacity: .618 !important;
}

[imt-state="dual"] .immersive-translate-target-translation-theme-mask-inner {
  display: inline-block !important;
  filter: blur(5px) !important;
  transition: filter .3s ease !important;
}

[imt-state="dual"] .immersive-translate-target-translation-theme-mask-inner:hover,
[imt-state="dual"] .immersive-translate-target-translation-theme-mask-inner:focus-within {
  filter: none !important;
}

[imt-state="dual"] .immersive-translate-target-translation-theme-bold {
  font-weight: 700 !important;
}

[imt-state="dual"] .immersive-translate-target-translation-theme-italic {
  font-style: italic !important;
}

.immersive-translate-loading-spinner {
  display: inline-block !important;
  width: 10px !important;
  height: 10px !important;
  margin: 0 4px !important;
  padding: 0 !important;
  vertical-align: middle !important;
  border: 2px rgba(0, 0, 0, .18) solid !important;
  border-top-color: currentColor !important;
  border-left-color: currentColor !important;
  border-radius: 50% !important;
  animation: immersive-translate-loading-animation .6s infinite linear !important;
}

.immersive-translate-error-wrapper {
  display: inline-flex !important;
  align-items: baseline !important;
  gap: 8px !important;
  color: #b91c1c !important;
  font: inherit !important;
}

.immersive-translate-retry-button {
  appearance: none !important;
  border: 0 !important;
  border-bottom: 1px solid currentColor !important;
  border-radius: 0 !important;
  padding: 0 !important;
  background: transparent !important;
  color: inherit !important;
  font: inherit !important;
  cursor: pointer !important;
}

.immersive-translate-retry-button:focus-visible {
  outline: 2px solid currentColor !important;
  outline-offset: 2px !important;
}

@media (prefers-color-scheme: dark) {
  .immersive-translate-loading-spinner {
    border-color: rgba(255, 255, 255, .25) !important;
    border-top-color: currentColor !important;
    border-left-color: currentColor !important;
  }

  .immersive-translate-error-wrapper {
    color: #fca5a5 !important;
  }
}

@keyframes immersive-translate-loading-animation {
  from { transform: rotate(0deg); }
  to { transform: rotate(359deg); }
}
`;

export function normalizeTranslationTheme(value) {
  const theme = String(value || '').trim();
  return THEMES.has(theme) ? theme : 'none';
}

export function createTranslationDescriptor({
  status = 'translated',
  targetLang = '',
  theme = 'none',
  layout = 'block'
} = {}) {
  const normalizedTheme = normalizeTranslationTheme(theme);
  const normalizedLayout = layout === 'inline' ? 'inline' : 'block';
  return {
    tagName: 'font',
    layout: normalizedLayout,
    outerClasses: ['notranslate', 'immersive-translate-target-wrapper'],
    wrapperClasses: [
      'notranslate',
      `immersive-translate-target-translation-${normalizedLayout}-wrapper`,
      `immersive-translate-target-translation-${normalizedLayout}-wrapper-theme-${normalizedTheme}`,
      `immersive-translate-target-translation-theme-${normalizedTheme}`
    ],
    innerClasses: [
      'notranslate',
      'immersive-translate-target-inner',
      `immersive-translate-target-translation-theme-${normalizedTheme}-inner`,
      `is-${status}`
    ],
    attributes: {
      translate: 'no',
      dir: 'auto',
      lang: String(targetLang || ''),
      [TARGET_ATTRIBUTE]: 'true',
      'data-immersive-translate-translation-element-mark': '1'
    }
  };
}

export function chooseTranslationLayout(source, sourceText = '') {
  const text = String(sourceText || '').trim();
  if (!text || text.length > 24) return 'block';

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 4) return 'block';

  try {
    const style = source?.ownerDocument?.defaultView?.getComputedStyle?.(source);
    const lineHeight = Number.parseFloat(style?.lineHeight || '');
    const height = source?.getBoundingClientRect?.().height;
    if (Number.isFinite(lineHeight) && lineHeight > 0 && Number.isFinite(height) && height / lineHeight >= 2) {
      return 'block';
    }
  } catch {
    // Layout measurement is optional; the text thresholds remain deterministic.
  }

  return 'inline';
}

export function ensureImmersivePageStyles(doc = document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = IMMERSIVE_PAGE_CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

export function setImmersivePageRootState(doc = document, {
  state = 'dual',
  position = 'after',
  theme = 'none'
} = {}) {
  const root = doc.documentElement;
  root.setAttribute('imt-state', state === 'translation' ? 'translation' : 'dual');
  root.setAttribute('imt-trans-position', position === 'before' ? 'before' : 'after');
  root.setAttribute('data-immersive-translate-root-translation-theme', normalizeTranslationTheme(theme));
}

export function clearImmersivePageRootState(doc = document) {
  const root = doc.documentElement;
  root.removeAttribute('imt-state');
  root.removeAttribute('imt-trans-position');
  root.removeAttribute('data-immersive-translate-root-translation-theme');
}

function findMountedTarget(source) {
  const record = mountedRecords.get(source);
  if (record?.outer && record.outer.isConnected !== false) return record.outer;
  return Array.from(source.children || []).find(child => child.getAttribute?.(TARGET_ATTRIBUTE) === 'true') || null;
}

function setAttributes(element, attributes) {
  for (const [name, value] of Object.entries(attributes)) {
    if (value) element.setAttribute(name, value);
  }
}

export function mountImmersiveTranslation(source, {
  text = '',
  status = 'translated',
  targetLang = '',
  theme = 'none',
  loadingLabel = 'Translating',
  errorMessage = 'Translation failed',
  retryLabel = 'Retry',
  onRetry,
  layout = 'auto'
} = {}) {
  if (!source?.ownerDocument) throw new TypeError('A source element is required.');

  const doc = source.ownerDocument;
  ensureImmersivePageStyles(doc);
  setImmersivePageRootState(doc, { state: 'dual', theme });
  findMountedTarget(source)?.remove();

  const sourceText = getSourceTextWithoutTranslation(source);
  const resolvedLayout = layout === 'auto' ? chooseTranslationLayout(source, sourceText) : layout;
  const descriptor = createTranslationDescriptor({ status, targetLang, theme, layout: resolvedLayout });
  const outer = doc.createElement(descriptor.tagName);
  outer.className = descriptor.outerClasses.join(' ');
  if (status === 'error') outer.classList.add('immersive-translate-target-wrapper-error');
  setAttributes(outer, descriptor.attributes);

  if (descriptor.layout === 'block') {
    const lineBreak = doc.createElement('br');
    lineBreak.className = 'immersive-translate-target-break';
    outer.appendChild(lineBreak);
  } else {
    const spacer = doc.createElement(descriptor.tagName);
    spacer.className = 'notranslate immersive-translate-target-inline-spacer';
    spacer.setAttribute('translate', 'no');
    spacer.textContent = '\u00a0\u00a0';
    outer.appendChild(spacer);
  }

  const wrapper = doc.createElement(descriptor.tagName);
  wrapper.className = descriptor.wrapperClasses.join(' ');
  const inner = doc.createElement(descriptor.tagName);
  inner.className = descriptor.innerClasses.join(' ');

  if (status === 'loading') {
    inner.setAttribute('role', 'status');
    inner.setAttribute('aria-label', loadingLabel);
    const spinner = doc.createElement('span');
    spinner.className = 'immersive-translate-loading-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    inner.appendChild(spinner);
  } else if (status === 'error') {
    inner.classList.add('immersive-translate-error-wrapper');
    const message = doc.createElement('span');
    message.textContent = errorMessage;
    inner.appendChild(message);
    if (typeof onRetry === 'function') {
      const retry = doc.createElement('button');
      retry.type = 'button';
      retry.className = 'immersive-translate-retry-button';
      retry.textContent = retryLabel;
      retry.addEventListener('click', onRetry);
      inner.appendChild(retry);
    }
  } else {
    inner.textContent = String(text ?? '');
  }

  wrapper.appendChild(inner);
  outer.appendChild(wrapper);
  source.setAttribute(SOURCE_ATTRIBUTE, 'true');
  source.appendChild(outer);
  mountedRecords.set(source, { outer, wrapper, inner });
  return outer;
}

export function hasImmersiveTranslation(source) {
  return !!findMountedTarget(source);
}

export function removeImmersiveTranslation(source) {
  if (!source) return;
  findMountedTarget(source)?.remove();
  source.removeAttribute?.(SOURCE_ATTRIBUTE);
  mountedRecords.delete(source);
}

export function removeAllImmersiveTranslations(doc = document) {
  doc.querySelectorAll(TARGET_SELECTOR).forEach(target => target.remove());
  doc.querySelectorAll(`[${SOURCE_ATTRIBUTE}="true"]`).forEach(source => source.removeAttribute(SOURCE_ATTRIBUTE));
  clearImmersivePageRootState(doc);
  mountedRecords = new WeakMap();
}

export function getSourceTextWithoutTranslation(source) {
  if (!source) return '';
  const clone = source.cloneNode(true);
  clone.querySelectorAll?.(TARGET_SELECTOR).forEach(target => target.remove());
  return String(clone.innerText ?? clone.textContent ?? '').trim();
}

export function rangesIntersect(range, candidateRange, rangeConstants = globalThis.Range) {
  if (!range || !candidateRange || !rangeConstants) return false;
  return range.compareBoundaryPoints(rangeConstants.END_TO_START, candidateRange) > 0 &&
    range.compareBoundaryPoints(rangeConstants.START_TO_END, candidateRange) < 0;
}
