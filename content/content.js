// content/content.js

const api = (globalThis.browser ?? globalThis.chrome);

let lastContextSelection = null;
let pageTranslationSession = null;
let pageTranslationGeneration = 0;
let immersivePageModulePromise = null;
let translationRpcModulePromise = null;
let pageTranslationTogglePromise = Promise.resolve();
let pageDocumentActive = true;
let selectionNavigationGeneration = 0;
let selectionCaptureObserver = null;
let selectionCaptureDisposers = [];
const CONTEXT_SELECTION_TTL_MS = 5 * 60_000;

function createSelectionCaptureId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function normalizedSelectionText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function disposeSelectionCaptureGuards() {
  selectionCaptureObserver?.disconnect();
  selectionCaptureObserver = null;
  for (const dispose of selectionCaptureDisposers.splice(0)) {
    try { dispose(); } catch { }
  }
}

function clearSelectionCapture() {
  disposeSelectionCaptureGuards();
  lastContextSelection = null;
}

function invalidateSelectionCapture() {
  clearSelectionCapture();
  selectionNavigationGeneration += 1;
}

function isSelectionBoundaryConnected(node) {
  return !!node && node.ownerDocument === document && node.isConnected === true;
}

function isRangeConnected(range) {
  return !!range &&
    !range.collapsed &&
    isSelectionBoundaryConnected(range.startContainer) &&
    isSelectionBoundaryConnected(range.endContainer);
}

function nodeContains(container, node) {
  if (!container || !node) return false;
  if (container === node) return true;
  try {
    return typeof container.contains === 'function' && container.contains(node);
  } catch {
    return false;
  }
}

function rangeIntersectsNode(range, node) {
  if (!range || !node || typeof range.intersectsNode !== 'function') return false;
  try {
    return range.intersectsNode(node);
  } catch {
    return false;
  }
}

function mutationPointInsideRange(range, record) {
  const target = record?.target;
  if (!target || typeof range?.comparePoint !== 'function') return false;
  const children = Array.from(target.childNodes || []);
  let offset = children.length;
  const firstAdded = record.addedNodes?.[0];
  if (firstAdded && children.includes(firstAdded)) {
    offset = children.indexOf(firstAdded);
  } else if (record.nextSibling && children.includes(record.nextSibling)) {
    offset = children.indexOf(record.nextSibling);
  } else if (record.previousSibling && children.includes(record.previousSibling)) {
    offset = children.indexOf(record.previousSibling) + 1;
  }

  try {
    return range.comparePoint(target, offset) === 0;
  } catch {
    return false;
  }
}

function mutationTouchesSelectionCapture(record, captured) {
  if (!record || !captured?.range) return false;
  const boundaries = [captured.startContainer, captured.endContainer];
  if (record.type === 'characterData') {
    return boundaries.some(boundary => nodeContains(record.target, boundary)) ||
      rangeIntersectsNode(captured.range, record.target);
  }
  if (record.type !== 'childList') return false;

  const changedNodes = [
    ...Array.from(record.addedNodes || []),
    ...Array.from(record.removedNodes || [])
  ];
  if (changedNodes.some(node =>
    boundaries.some(boundary => nodeContains(node, boundary)) ||
    rangeIntersectsNode(captured.range, node)
  )) return true;

  return mutationPointInsideRange(captured.range, record);
}

function installSelectionCaptureGuards(captured) {
  const invalidateIfCurrent = () => {
    if (lastContextSelection?.id === captured.id) invalidateSelectionCapture();
  };
  const addLifecycleGuard = (target, type) => {
    if (typeof target?.addEventListener !== 'function') return;
    try {
      target.addEventListener(type, invalidateIfCurrent);
      selectionCaptureDisposers.push(() => target.removeEventListener(type, invalidateIfCurrent));
    } catch { }
  };

  for (const type of ['popstate', 'hashchange', 'pageshow', 'pagehide']) {
    addLifecycleGuard(window, type);
  }
  addLifecycleGuard(globalThis.navigation, 'navigate');

  const timeoutId = setTimeout(invalidateIfCurrent, CONTEXT_SELECTION_TTL_MS);
  selectionCaptureDisposers.push(() => clearTimeout(timeoutId));

  const common = captured.range.commonAncestorContainer;
  const observerRoot = common?.nodeType === 3 ? common.parentNode : common;
  if (!observerRoot || typeof MutationObserver !== 'function') return;
  selectionCaptureObserver = new MutationObserver(records => {
    if (records.some(record => mutationTouchesSelectionCapture(record, captured))) {
      invalidateIfCurrent();
    }
  });
  selectionCaptureObserver.observe(observerRoot, {
    childList: true,
    characterData: true,
    subtree: true
  });
  // Observe only the direct child list on each ancestor. This catches a
  // selected subtree being removed and restored without subscribing to every
  // unrelated descendant mutation in the document.
  for (let node = observerRoot; node;) {
    const parent = node.parentNode || node.host || null;
    if (!parent) break;
    selectionCaptureObserver.observe(parent, { childList: true });
    node = parent;
  }
}

document.addEventListener('contextmenu', () => {
  clearSelectionCapture();
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;

  try {
    const range = selection.getRangeAt(0).cloneRange();
    const captured = {
      id: createSelectionCaptureId(),
      range,
      startContainer: range.startContainer,
      endContainer: range.endContainer,
      text: selection.toString(),
      capturedAt: Date.now(),
      document,
      frame: window,
      url: location.href,
      generation: selectionNavigationGeneration
    };
    lastContextSelection = captured;
    installSelectionCaptureGuards(captured);
  } catch {
    clearSelectionCapture();
  }
}, true);

function selectionCaptureMatches(captured, sourceText = '', sourceUrl = '', captureGeneration = null) {
  const expected = normalizedSelectionText(sourceText);
  if (!captured || !pageDocumentActive) return null;

  try {
    const currentText = normalizedSelectionText(captured.range.toString());
    const capturedText = normalizedSelectionText(captured.text);
    const capturedMatches =
      Date.now() - captured.capturedAt < CONTEXT_SELECTION_TTL_MS &&
      captured.document === document &&
      captured.frame === window &&
      captured.generation === selectionNavigationGeneration &&
      (captureGeneration === null || captured.generation === captureGeneration) &&
      captured.url === location.href &&
      (!sourceUrl || captured.url === sourceUrl) &&
      isRangeConnected(captured.range) &&
      currentText.length > 0 &&
      currentText === capturedText &&
      (!expected || currentText === expected);

    return capturedMatches;
  } catch {
    // A detached or mutated live Range may throw while being inspected.
    return false;
  }
}

function getSelectionCaptureContext(sourceText = '', sourceUrl = '') {
  const captured = lastContextSelection;
  if (!selectionCaptureMatches(captured, sourceText, sourceUrl)) return null;
  return {
    captureId: captured.id,
    generation: captured.generation,
    sourceUrl: captured.url
  };
}

function takeSelectionRange(sourceText = '', sourceUrl = '', captureId = '', captureGeneration = null) {
  const captured = lastContextSelection;
  // A result is owned by the exact context-menu capture acknowledged before
  // translation. A late result must not consume a newer same-text selection.
  if (!captured ||
      !captureId ||
      !Number.isInteger(captureGeneration) ||
      captured.id !== captureId) return null;
  clearSelectionCapture();
  if (!selectionCaptureMatches(captured, sourceText, sourceUrl, captureGeneration)) return null;

  try {
    return captured.range.cloneRange();
  } catch {
    return null;
  }
}

const TRANSLATION_STYLE_DEFAULTS = {
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif',
  fontSize: '14px',
  themeMode: 'auto',
  textColor: '#0f172a',
  bubbleColor: '#ffffff',
  borderColor: '#e2e8f0'
};

const FLOATING_UI_Z_INDEX = 2147483647;
const FLOATING_UI_VIEWPORT_PADDING = 12;
const FLOATING_UI_SELECTION_GAP = 24;
const MIN_TEXT_CONTRAST = 4.5;
const THEME_MODES = new Set(['auto', 'light', 'dark', 'custom']);
const LIGHT_THEME = {
  textColor: '#0f172a',
  bubbleColor: '#ffffff',
  borderColor: '#e2e8f0',
  shadow: '0 8px 30px rgba(15,23,42,.14)'
};
const DARK_THEME = {
  textColor: '#e5edf5',
  bubbleColor: '#111827',
  borderColor: '#334155',
  shadow: '0 12px 36px rgba(0,0,0,.42)'
};

// ---- lightweight settings ----
async function getSettingsLite() {
  const { getSettings } = await safeImport('core/settings.js');
  const v = await getSettings();
  return {
    targetLang: v.targetLang,
    ytBilingualOverlay: v.ytBilingualOverlay,
    showReasoningPeek: v.showReasoningPeek !== false, // default: true
    translationTheme: v.translationTheme || 'none',
    translationStyle: normalizeTranslationStyle(v)
  };
}

function getImmersivePageModule() {
  if (!immersivePageModulePromise) {
    immersivePageModulePromise = safeImport('content/immersivePage.js');
  }
  return immersivePageModulePromise;
}

function getTranslationRpcModule() {
  if (!translationRpcModulePromise) {
    translationRpcModulePromise = safeImport('core/translationRpc.js');
  }
  return translationRpcModulePromise;
}

function normalizeColor(value, fallback) {
  const s = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(s) ? s : fallback;
}

function normalizeFontSize(value) {
  const n = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(n)) return TRANSLATION_STYLE_DEFAULTS.fontSize;
  return `${Math.min(28, Math.max(10, n))}px`;
}

function normalizeFontFamily(value) {
  const s = String(value || '').replace(/[;"{}<>]/g, '').trim();
  return s ? s.slice(0, 120) : TRANSLATION_STYLE_DEFAULTS.fontFamily;
}

function normalizeTranslationStyle(v = {}) {
  const bubbleColor = normalizeColor(v.translationBubbleColor, TRANSLATION_STYLE_DEFAULTS.bubbleColor);
  const requestedTextColor = normalizeColor(v.translationTextColor, TRANSLATION_STYLE_DEFAULTS.textColor);
  const customColorKeys = [
    ['translationTextColor', TRANSLATION_STYLE_DEFAULTS.textColor],
    ['translationBubbleColor', TRANSLATION_STYLE_DEFAULTS.bubbleColor],
    ['translationBorderColor', TRANSLATION_STYLE_DEFAULTS.borderColor]
  ];
  const hasLegacyCustomColors = customColorKeys.some(([key, fallback]) => {
    const value = String(v[key] || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/i.test(value) && value !== fallback.toLowerCase();
  });
  const rawThemeMode = String(v.translationThemeMode || '').trim();
  const themeMode = THEME_MODES.has(rawThemeMode)
    ? rawThemeMode
    : (hasLegacyCustomColors ? 'custom' : TRANSLATION_STYLE_DEFAULTS.themeMode);
  return {
    themeMode,
    fontFamily: normalizeFontFamily(v.translationFontFamily),
    fontSize: normalizeFontSize(v.translationFontSize),
    textColor: readableTextColor(requestedTextColor, bubbleColor),
    bubbleColor,
    borderColor: normalizeColor(v.translationBorderColor, TRANSLATION_STYLE_DEFAULTS.borderColor)
  };
}

function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const channel = (value) => {
    const n = value / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  if (l1 == null || l2 == null) return Number.POSITIVE_INFINITY;
  const high = Math.max(l1, l2);
  const low = Math.min(l1, l2);
  return (high + 0.05) / (low + 0.05);
}

function readableTextColor(textColor, bubbleColor) {
  if (contrastRatio(textColor, bubbleColor) >= MIN_TEXT_CONTRAST) return textColor;
  const dark = '#111827';
  const light = '#f8fafc';
  return contrastRatio(light, bubbleColor) >= contrastRatio(dark, bubbleColor) ? light : dark;
}

function parseCssColor(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === 'transparent') return null;

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const body = hex[1].length === 3
      ? hex[1].split('').map(ch => ch + ch).join('')
      : hex[1];
    const n = Number.parseInt(body, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }

  const rgb = /^rgba?\((.+)\)$/i.exec(raw);
  if (!rgb) return null;
  const parts = rgb[1].split(',').map(part => part.trim());
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map(part => {
    if (part.endsWith('%')) return Math.round(Number.parseFloat(part) * 2.55);
    return Number.parseFloat(part);
  });
  if (channels.some(n => !Number.isFinite(n))) return null;
  const alpha = parts[3] == null ? 1 : Number.parseFloat(parts[3]);
  return {
    r: clamp(Math.round(channels[0]), 0, 255),
    g: clamp(Math.round(channels[1]), 0, 255),
    b: clamp(Math.round(channels[2]), 0, 255),
    a: Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

function blendColor(top, bottom) {
  const a = top.a + bottom.a * (1 - top.a);
  if (a <= 0) return { r: 255, g: 255, b: 255, a: 1 };
  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
    a
  };
}

function elementFromRange(range) {
  if (!range) return null;
  const node = range.commonAncestorContainer;
  const ancestor = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const rect = range.getBoundingClientRect?.();
  if (rect && rect.width >= 0 && rect.height >= 0) {
    const x = clamp(rect.left + rect.width / 2, 0, Math.max(0, window.innerWidth - 1));
    const y = clamp(rect.top + rect.height / 2, 0, Math.max(0, window.innerHeight - 1));
    const pointed = document.elementFromPoint(x, y);
    if (pointed && !pointed.closest?.('#it-selection-pop, .it-inline-translation, .it-think-pop, .immersive-translate-target-wrapper')) {
      return pointed;
    }
  }
  return ancestor || document.body;
}

function effectiveBackgroundForElement(el) {
  const start = el?.nodeType === Node.ELEMENT_NODE ? el : document.body;
  const colors = [];
  let node = start;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const bg = parseCssColor(getComputedStyle(node).backgroundColor);
    if (bg && bg.a > 0.01) colors.push(bg);
    node = node.parentElement;
  }

  let blended = { r: 255, g: 255, b: 255, a: 1 };
  for (const color of colors.reverse()) blended = blendColor(color, blended);
  return { hex: rgbToHex(blended), foundColor: colors.length > 0 };
}

function pageContextLooksDark(context) {
  const el = context?.nodeType === Node.ELEMENT_NODE ? context : document.body;
  const bg = effectiveBackgroundForElement(el);
  const bgLum = relativeLuminance(bg.hex);
  if (bgLum != null && bgLum < 0.45) return true;

  if (!bg.foundColor) {
    const text = parseCssColor(getComputedStyle(el).color);
    const textLum = text ? relativeLuminance(rgbToHex(text)) : null;
    if (textLum != null && textLum > 0.65) return true;
  }
  return false;
}

function resolveTranslationStyle(style, context) {
  const base = style || TRANSLATION_STYLE_DEFAULTS;
  const themeMode = THEME_MODES.has(base.themeMode) ? base.themeMode : TRANSLATION_STYLE_DEFAULTS.themeMode;
  if (themeMode === 'custom') {
    return {
      ...base,
      textColor: readableTextColor(base.textColor, base.bubbleColor),
      shadow: LIGHT_THEME.shadow
    };
  }

  const dark = themeMode === 'dark' || (themeMode === 'auto' && pageContextLooksDark(context));
  const palette = dark ? DARK_THEME : LIGHT_THEME;
  return {
    ...base,
    textColor: palette.textColor,
    bubbleColor: palette.bubbleColor,
    borderColor: palette.borderColor,
    shadow: palette.shadow
  };
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

function placeSelectionPopup(pop, rect) {
  const maxWidth = Math.min(400, window.innerWidth - FLOATING_UI_VIEWPORT_PADDING * 2);
  const minWidth = Math.min(200, maxWidth);
  pop.style.maxWidth = `${maxWidth}px`;
  pop.style.minWidth = `${minWidth}px`;
  pop.style.left = `${clamp(rect.left, FLOATING_UI_VIEWPORT_PADDING, window.innerWidth - maxWidth - FLOATING_UI_VIEWPORT_PADDING)}px`;

  const measuredHeight = pop.offsetHeight || 120;
  const belowTop = rect.bottom + FLOATING_UI_SELECTION_GAP;
  const aboveTop = rect.top - measuredHeight - FLOATING_UI_SELECTION_GAP;
  const fitsBelow = belowTop + measuredHeight <= window.innerHeight - FLOATING_UI_VIEWPORT_PADDING;
  const top = fitsBelow
    ? belowTop
    : clamp(aboveTop, FLOATING_UI_VIEWPORT_PADDING, window.innerHeight - measuredHeight - FLOATING_UI_VIEWPORT_PADDING);
  pop.style.top = `${top}px`;
}

function applyTranslationStyle(el, style, context) {
  if (!el) return;
  const s = resolveTranslationStyle(style, context || el);
  el._itResolvedStyle = s;
  el.style.setProperty('font-family', s.fontFamily, 'important');
  el.style.setProperty('font-size', s.fontSize, 'important');
  el.style.setProperty('color', s.textColor, 'important');
  el.style.setProperty('background-color', s.bubbleColor, 'important');
  el.style.setProperty('border-color', s.borderColor, 'important');
  if (s.shadow) el.style.setProperty('box-shadow', s.shadow, 'important');
  const targets = el.querySelectorAll ? el.querySelectorAll('.tgt') : [];
  targets.forEach(node => { node.style.setProperty('color', s.textColor, 'important'); });
  const popupText = el.querySelectorAll ? el.querySelectorAll('.it-selection-content, .it-selection-content *') : [];
  popupText.forEach(node => { node.style.setProperty('color', s.textColor, 'important'); });
}

function applyResolvedColors(el, style) {
  if (!el || !style) return;
  el.style.setProperty('color', style.textColor, 'important');
  el.style.setProperty('background-color', style.bubbleColor, 'important');
  el.style.setProperty('border-color', style.borderColor, 'important');
  if (style.shadow) el.style.setProperty('box-shadow', style.shadow, 'important');
}

function styleThinkButton(btn, style) {
  if (!btn || !style) return;
  btn.style.setProperty('background-color', style.bubbleColor, 'important');
  btn.style.setProperty('color', style.textColor, 'important');
  btn.style.setProperty('border-color', style.borderColor, 'important');
}

// ---- safe dynamic import ----
async function safeImport(path) {
  try { return await import(api.runtime.getURL(path)); }
  catch (e) {
    try {
      await api.runtime.sendMessage({
        action: 'log', level: 'error', scope: 'content',
        msg: `dynamic import failed: ${path}`, error: { message: e?.message, stack: e?.stack }
      });
    } catch { }
    console.error('[IT][content] dynamic import failed:', path, e);
    throw e;
  }
}

// ---- styles ----
(function ensureStyles() {
  if (document.getElementById('it-inline-style')) return;
  const s = document.createElement('style');
  s.id = 'it-inline-style';
  s.textContent = `
  .it-inline-translation{
    position:relative;
    margin:8px 0 12px;
    padding:10px 12px;
    border:1px solid rgba(0,0,0,.08);
    border-radius:10px;
    background:#fff;
    color:#111;
    box-shadow:0 4px 18px rgba(0,0,0,.06);
    font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Noto Sans,sans-serif;
    display:flex;
    justify-content:space-between;
    align-items:flex-start;
    gap:8px;
  }
  .it-inline-translation .tgt{ color:inherit; flex-grow:1; }
  .it-inline-translation .close{ cursor:pointer; opacity:.6; flex-shrink:0; }

  .it-think-btn{
    position:absolute; left:-8px; top:10px; transform:translateX(-100%);
    border:none; background:#fff; color:#334155; cursor:pointer;
    border-radius:8px; padding:4px 6px; font-size:12px;
    box-shadow:0 2px 10px rgba(0,0,0,.12); border:1px solid rgba(0,0,0,.08);
  }
  .it-think-btn:hover{ background:#f8fafc }

  .it-think-pop{
    position:absolute; z-index:2147483000; max-width:520px; min-width:360px;
    white-space:pre-wrap; font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background:#fff; color:#111; border:1px solid rgba(0,0,0,.12);
    border-radius:10px; box-shadow:0 12px 40px rgba(0,0,0,.18);
    padding:12px;
  }`;
  document.documentElement.appendChild(s);
})();

// ---- dictionary bubble ----
let bubble;
function ensureBubble() {
  if (bubble) return bubble;
  bubble = document.createElement('div');
  bubble.style.cssText =
    'position:fixed;z-index:2147483647;max-width:360px;background:#fff;color:#222;border:1px solid #ddd;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.12);padding:12px;font:14px/1.45 system-ui;';
  document.body.appendChild(bubble); return bubble;
}
function placeBubble(range = null) {
  const selection = window.getSelection();
  const activeRange = range || (selection?.rangeCount ? selection.getRangeAt(0) : null);
  const rect = activeRange?.getBoundingClientRect?.();
  const x = (rect?.left || 24), y = (rect?.bottom || 24);
  bubble.style.left = Math.min(x, window.innerWidth - 380) + 'px';
  bubble.style.top = Math.min(y + 8, window.innerHeight - 220) + 'px';
}
function renderDictionaryBubble(dic, style, range = null) {
  const r = range || (window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null);
  const context = elementFromRange(r);
  const b = ensureBubble(); placeBubble(r);
  const { headword = '', phonetic = '', senses = [], synonyms = [] } = dic || {};
  b.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
      <strong>${esc(headword)}</strong><span style="opacity:.7">${esc(phonetic || '')}</span>
      <button id="it-x" style="margin-left:auto;border:none;background:transparent;cursor:pointer">✕</button>
    </div>
    ${(senses || []).map(s => `
      <div class="gloss">${esc(s.gloss_tl || s.gloss || '')}</div>
      ${s.examples?.length
      ? `<div>${s.examples.slice(0, 3).map(e => `<div class="ex">• ${esc(e.src || '')}<br><span style="opacity:.75">（${esc(e.tgt || '')}）</span></div>`).join('')}</div>`
      : ''
    }
    `).join('')}
    ${synonyms?.length ? `<div style="margin-top:6px;opacity:.8">${esc(synonyms.join(', '))}</div>` : ''}
  `;
  applyTranslationStyle(b, style, context);
  b.querySelector('#it-x')?.addEventListener('click', () => { b.remove(); bubble = null; });
}

// ---- inline rendering + think peek ----
function insertBelow(el, html, meta, style) {
  const holder = document.createElement('div');
  holder.className = 'it-inline-translation';
  holder.innerHTML = `${html}<span class="close">✕</span>`;
  applyTranslationStyle(holder, style, el);
  el.after(holder);
  holder.querySelector('.close')?.addEventListener('click', () => {
    disposeThinkPopover(holder);
    holder.remove();
  });

  const think = meta?.think;
  if (meta?.allowPeek && think && typeof think === 'string' && think.trim()) {
    const b = document.createElement('button');
    b.className = 'it-think-btn';
    b.title = 'Show reasoning';
    b.textContent = '🧠';
    b.addEventListener('click', () => toggleThinkPopover(holder, think));
    holder.prepend(b);
    styleThinkButton(b, holder._itResolvedStyle);
  }
  return holder;
}
function disposeThinkPopover(holder) {
  if (!holder) return;
  holder._thinkObserver?.disconnect?.();
  holder._thinkObserver = null;
  holder._thinkPop?.remove?.();
  holder._thinkPop = null;
}
function toggleThinkPopover(holder, thinkText) {
  let pop = holder._thinkPop;
  if (pop) { disposeThinkPopover(holder); return; }
  pop = document.createElement('div');
  pop.className = 'it-think-pop';
  pop.textContent = thinkText;
  holder._thinkPop = pop;
  applyResolvedColors(pop, holder._itResolvedStyle || resolveTranslationStyle(TRANSLATION_STYLE_DEFAULTS, holder));
  const rect = holder.getBoundingClientRect();
  pop.style.top = (rect.top + window.scrollY + 8) + 'px';
  pop.style.left = (rect.left + window.scrollX + 12) + 'px';
  document.body.appendChild(pop);
  if (typeof MutationObserver === 'function') {
    holder._thinkObserver = new MutationObserver(() => {
      if (!holder.isConnected) disposeThinkPopover(holder);
    });
    holder._thinkObserver.observe(document.documentElement, { childList: true, subtree: true });
  }
}

function renderSelectionPopup(r, text, meta, style) {
  let pop = document.getElementById('it-selection-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'it-selection-pop';
    pop.style.cssText = `all:initial;display:block;position:fixed;z-index:${FLOATING_UI_Z_INDEX};max-width:400px;min-width:200px;box-sizing:border-box;background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.12);padding:14px;font:14px/1.5 system-ui,-apple-system,sans-serif;color:inherit;overflow-wrap:anywhere;white-space:normal;`;
    document.body.appendChild(pop);
  }
  disposeThinkPopover(pop);
  
  const rect = r.getBoundingClientRect();
  const context = elementFromRange(r);
  
  const htmlObj = `<div>${esc(text)}</div>`;
  
  pop.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div class="it-selection-content" style="flex-grow:1;">${htmlObj}</div>
      <span class="close" style="cursor:pointer;opacity:0.6;font-size:14px;line-height:1;margin-top:2px;color:currentColor;">✕</span>
    </div>
  `;
  applyTranslationStyle(pop, style, context);
  placeSelectionPopup(pop, rect);
  
  pop.querySelector('.close')?.addEventListener('click', () => {
    disposeThinkPopover(pop);
    pop.remove();
  });

  const think = meta?.think;
  if (meta?.allowPeek && think && typeof think === 'string' && think.trim()) {
    const b = document.createElement('button');
    b.className = 'it-think-btn';
    b.title = 'Show reasoning';
    b.textContent = '🧠';
    b.addEventListener('click', () => toggleThinkPopover(pop, think));
    pop.prepend(b);
    styleThinkButton(b, pop._itResolvedStyle);
  }
}

function htmlForTargetOnly(tgt) { return `<div class="tgt">${esc(tgt)}</div>`; }
function closestBlockFromRange(r) {
  let el = r?.commonAncestorContainer;
  if (el?.nodeType === 3) el = el.parentElement;
  return el?.closest?.('p,li,blockquote,div,section,article,td,th,h1,h2,h3,h4,h5,h6') || el || document.body;
}

// ---- main-content detection ----
const MAIN_POSITIVE = ['article', 'main', 'content', 'post', 'entry', 'story', 'read', 'body', 'page', 'text', 'rich', 'markdown'];
const MAIN_NEGATIVE = ['nav', 'menu', 'footer', 'header', 'sidebar', 'aside', 'comment', 'related', 'promo', 'advert', 'share', 'subscribe', 'breadcrumb', 'recommend'];
const BLOCK_SELECTOR = 'p, li, blockquote, h1,h2,h3,h4,h5,h6, figcaption, td, th, dd, dt, div, section, [role="paragraph"]';
const EXCLUDED_TRANSLATION_ANCESTORS = [
  'nav',
  'header',
  'footer',
  'aside',
  '[role="navigation"]',
  '[translate="no"]',
  '.notranslate',
  '[contenteditable]:not([contenteditable="false"])',
  'script',
  'style',
  'textarea',
  'select',
  'option',
  'pre',
  'kbd',
  'samp',
  'svg',
  'math',
  'canvas',
  'noscript',
  '.immersive-translate-target-wrapper',
  '#it-selection-pop',
  '.it-think-pop'
].join(',');

function scoreNode(el) {
  if (!el || !el.tagName) return -1;
  const tag = el.tagName.toLowerCase();
  let s = 0;
  if (tag === 'article') s += 60;
  if (tag === 'main') s += 50;
  if (tag === 'section') s += 8;
  if (tag === 'div') s += 3;
  const role = (el.getAttribute('role') || '').toLowerCase();
  if (role === 'main') s += 40;
  if (el.getAttribute('itemprop')?.toLowerCase() === 'articlebody') s += 30;
  const id = (el.id || '').toLowerCase();
  const cls = (el.className || '').toString().toLowerCase();
  for (const k of MAIN_POSITIVE) if (id.includes(k) || cls.includes(k)) s += 8;
  for (const k of MAIN_NEGATIVE) if (id.includes(k) || cls.includes(k)) s -= 15;
  const text = el.innerText || '';
  const len = text.replace(/\s+/g, ' ').length;
  const links = el.querySelectorAll('a').length;
  s += Math.min(60, Math.floor(len / 400));
  s -= Math.min(30, links * 1);
  return s;
}

function pickMainRoot(doc = document) {
  const candidates = Array.from(doc.querySelectorAll(
    'article, main, [role="main"], [itemprop="articleBody"],' +
    '#content, #main, #primary, .content, .main, .article, .post, .entry, .story, .article-body, .entry-content, .post-content, .content__body, .rich-text, .markdown-body'
  ));
  const bigBlocks = Array.from(doc.querySelectorAll('section,div'))
    .filter(el => (el.innerText || '').trim().length > 500);
  for (const el of bigBlocks) if (!candidates.includes(el)) candidates.push(el);

  let best = null, bestScore = -1;
  for (const el of candidates) {
    const sc = scoreNode(el);
    if (sc > bestScore) { best = el; bestScore = sc; }
  }
  return best || null;
}

function collectBlocks(root) {
  const all = [
    ...(root?.matches?.(BLOCK_SELECTOR) ? [root] : []),
    ...Array.from(root.querySelectorAll(BLOCK_SELECTOR))
  ];
  return all.filter(el => {
    if (!el.innerText) return false;
    const txt = el.innerText.trim();
    if (txt.length < 2) return false;
    if (el.hasAttribute('data-it-translation-source')) return false;
    if (el.closest(EXCLUDED_TRANSLATION_ANCESTORS)) return false;
    if (Array.from(el.querySelectorAll(BLOCK_SELECTOR)).some(child => (child.innerText || '').trim().length >= 2)) return false;
    if (/^(DIV|SECTION)$/.test(el.tagName) && el.querySelector('button, input, select, textarea, [role="button"], [role="menu"], [role="dialog"]')) return false;
    const id = (el.id || '').toLowerCase(), cls = (el.className || '').toString().toLowerCase();
    if (MAIN_NEGATIVE.some(k => id.includes(k) || cls.includes(k))) return false;
    return true;
  });
}

function selectedBlocksFromRange(r) {
  if (!r || r.collapsed) return [];
  const blocks = collectBlocks(document.body);
  return blocks.filter((el) => {
    const nr = document.createRange();
    nr.selectNodeContents(el);
    const intersects = r.compareBoundaryPoints(Range.END_TO_START, nr) > 0 &&
      r.compareBoundaryPoints(Range.START_TO_END, nr) < 0;
    nr.detach?.();
    return intersects;
  });
}

// ---- page translation ----
function i18nMessage(key, fallback) {
  return api.i18n?.getMessage?.(key) || fallback;
}

function deactivatePageTranslationSession(session) {
  if (session) {
    session.active = false;
    if (!session.controller.signal.aborted) {
      const error = new Error('Page translation stopped.');
      error.name = 'AbortError';
      error.code = 'TRANSLATION_CANCELLED';
      session.controller.abort(error);
    }
    session.observer?.disconnect();
    clearTimeout(session.observerTimer);
    session.translationQueue.clear();
    session.dirtySources.clear();
    void session.closeContext?.(session.contextId);
  }
}

function stopPageTranslation(renderer) {
  const session = pageTranslationSession;
  deactivatePageTranslationSession(session);
  pageTranslationGeneration += 1;
  renderer.removeAllImmersiveTranslations(document);
  pageTranslationSession = null;
}

function pruneDetachedPageBlocks(session) {
  for (const block of session.dirtySources) {
    if (block?.isConnected === false) session.dirtySources.delete(block);
  }
}

const PAGE_TRANSLATION_BATCH_SIZE = 40;

async function translatePageBlockBatch(blocks, session, renderer) {
  if (!session.active || !blocks.length) return;

  const [batchTools, translationRpc] = await Promise.all([
    safeImport('core/batchTranslation.js'),
    getTranslationRpcModule()
  ]);
  const entries = blocks
    .filter(el => el?.isConnected !== false)
    .map(el => ({ el, text: renderer.getSourceTextWithoutTranslation(el) }))
    .filter(entry => entry.text);
  if (!entries.length) return;

  const versions = new Map();
  for (const { el } of entries) {
    const version = (session.blockVersions.get(el) || 0) + 1;
    session.blockVersions.set(el, version);
    versions.set(el, version);
    renderer.mountImmersiveTranslation(el, {
      status: 'loading',
      targetLang: session.settings.targetLang,
      theme: session.settings.translationTheme,
      loadingLabel: i18nMessage('translationLoading', 'Translating')
    });
  }

  const resp = await translationRpc.sendCancellableTranslation({
    action: 'translateText',
    text: batchTools.createBatchPayload(entries.map(entry => entry.text)),
    targetLang: session.settings.targetLang,
    intent: 'page',
    contextId: session.contextId
  }, {
    signal: session.controller.signal,
    prefix: `page-${session.id}`
  }).catch(() => null);

  if (!session.active || session.id !== pageTranslationGeneration) return;
  const isCurrent = el => session.blockVersions.get(el) === versions.get(el);
  const renderError = (el, message) => {
    if (!isCurrent(el)) return;
    renderer.mountImmersiveTranslation(el, {
      status: 'error',
      targetLang: session.settings.targetLang,
      theme: session.settings.translationTheme,
      errorMessage: message || i18nMessage('translationFailed', 'Translation failed'),
      retryLabel: i18nMessage('retryTranslation', 'Retry'),
      onRetry: () => {
        renderer.removeImmersiveTranslation(el);
        enqueuePageBlocks([el], session, renderer);
      }
    });
  };

  if (!resp?.ok) {
    entries.forEach(({ el }) => renderError(el, resp?.error));
    return;
  }

  const batch = batchTools.splitBatchTranslation(resp.result?.translated || '', entries.length);
  if (!batch.matched) {
    console.warn('[IT] Page translation count mismatch', {
      expected: batch.expectedCount,
      actual: batch.actualCount
    });
  }

  entries.forEach(({ el }, index) => {
    if (!isCurrent(el)) return;
    const translated = String(batch.items[index] || '').trim();
    if (!translated) {
      renderError(el, i18nMessage('translationIncomplete', 'Translation result was incomplete'));
      return;
    }
    if (normalizedSelectionText(translated) === normalizedSelectionText(entries[index].text)) {
      renderer.removeImmersiveTranslation(el);
      return;
    }
    renderer.mountImmersiveTranslation(el, {
      text: translated,
      status: 'translated',
      targetLang: session.settings.targetLang,
      theme: session.settings.translationTheme
    });
  });
}

async function drainPageTranslationQueue(session, renderer) {
  while (session.active && session.translationQueue.size) {
    const blocks = session.translationQueue
      .take(PAGE_TRANSLATION_BATCH_SIZE)
      .filter(block => block?.isConnected !== false);
    if (!blocks.length) continue;
    await translatePageBlockBatch(blocks, session, renderer);
  }
}

function startPageTranslationDrain(session, renderer) {
  if (!session.active || session.queueDrainPromise || !session.translationQueue.size) return;
  const drain = drainPageTranslationQueue(session, renderer)
    .catch(() => {})
    .finally(() => {
      if (session.queueDrainPromise === drain) session.queueDrainPromise = null;
      if (session.active && session.translationQueue.size) {
        startPageTranslationDrain(session, renderer);
      }
    });
  session.queueDrainPromise = drain;
}

function enqueuePageBlocks(blocks, session, renderer) {
  const candidates = Array.from(new Set(blocks)).filter(block =>
    block?.isConnected !== false &&
    !renderer.hasImmersiveTranslation(block)
  );
  if (!candidates.length) return;
  session.translationQueue.enqueue(candidates);
  startPageTranslationDrain(session, renderer);
}

function observePageTranslations(session, renderer) {
  if (typeof MutationObserver !== 'function') return;

  session.observer = new MutationObserver(mutations => {
    if (!session.active) return;
    pruneDetachedPageBlocks(session);
    let externalChange = false;
    for (const mutation of mutations) {
      const changedNodes = mutation.type === 'characterData'
        ? [mutation.target]
        : [...mutation.addedNodes, ...mutation.removedNodes];
      const ownWrapperOnly = mutation.type === 'childList' && changedNodes.length > 0 && changedNodes.every(node => {
        const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        return !!el?.closest?.('.immersive-translate-target-wrapper');
      });
      if (ownWrapperOnly) continue;

      const nodes = mutation.type === 'characterData'
        ? changedNodes
        : [mutation.target, ...changedNodes];
      for (const node of nodes) {
        const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (el?.closest?.('.immersive-translate-target-wrapper')) continue;
        externalChange = true;
        const source = el?.closest?.('[data-it-translation-source="true"]');
        if (source && !session.dirtySources.has(source)) {
          session.dirtySources.add(source);
          session.blockVersions.set(source, (session.blockVersions.get(source) || 0) + 1);
        }
      }
    }
    if (!externalChange) return;

    clearTimeout(session.observerTimer);
    session.observerTimer = setTimeout(() => {
      if (!session.active) return;
      if (session.root.isConnected === false) {
        stopPageTranslation(renderer);
        return;
      }
      const dirtyBlocks = Array.from(session.dirtySources)
        .filter(block => block?.isConnected !== false);
      session.dirtySources.clear();
      dirtyBlocks.forEach(block => renderer.removeImmersiveTranslation(block));

      const newBlocks = collectBlocks(session.root)
        .filter(block => !renderer.hasImmersiveTranslation(block));
      enqueuePageBlocks([...dirtyBlocks, ...newBlocks], session, renderer);
    }, 350);
  });
  session.observer.observe(session.root, { childList: true, characterData: true, subtree: true });
}

async function translatePageInline() {
  const [renderer, translationRpc, queueTools] = await Promise.all([
    getImmersivePageModule(),
    getTranslationRpcModule(),
    safeImport('core/orderedQueue.js')
  ]);
  if (!pageDocumentActive) return { state: 'original' };
  if (pageTranslationSession?.active) {
    stopPageTranslation(renderer);
    return { state: 'original' };
  }

  const sLite = await getSettingsLite();
  if (!pageDocumentActive) return { state: 'original' };
  const root = pickMainRoot(document) || document.body;
  let blocks;

  if (root) {
    blocks = collectBlocks(root);
    if (blocks.length < 3) blocks = collectBlocks(document);
  } else {
    blocks = Array.from(document.querySelectorAll(
      'article p, article li, main p, main li, p, li, blockquote, h1,h2,h3,h4,h5,h6, figcaption, td, th'
    )).filter(el => el?.innerText && el.innerText.trim().length > 0 && !el.nextElementSibling?.classList?.contains('it-inline-translation'));
  }

  if (!blocks.length) {
    renderer.clearImmersivePageRootState(document);
    return { state: 'empty' };
  }

  const session = {
    id: ++pageTranslationGeneration,
    active: true,
    root,
    renderer,
    settings: sLite,
    blockVersions: new WeakMap(),
    dirtySources: new Set(),
    translationQueue: new queueTools.OrderedUniqueQueue(),
    queueDrainPromise: null,
    observer: null,
    observerTimer: null,
    contextId: translationRpc.createTranslationRequestId('page-context'),
    closeContext: translationRpc.closeTranslationContext,
    controller: new AbortController()
  };
  pageTranslationSession = session;
  renderer.ensureImmersivePageStyles(document);
  renderer.setImmersivePageRootState(document, {
    state: 'dual',
    position: 'after',
    theme: sLite.translationTheme
  });
  enqueuePageBlocks(blocks, session, renderer);
  if (session.active) observePageTranslations(session, renderer);
  return { state: session.active ? 'dual' : 'original' };
}

function queuePageTranslationToggle() {
  pageTranslationTogglePromise = pageTranslationTogglePromise
    .catch(() => {})
    .then(() => translatePageInline());
  return pageTranslationTogglePromise;
}

// ---- message handling ----
api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.action === 'getSelectionCapture') {
      const capture = getSelectionCaptureContext(msg.sourceText || '', msg.sourceUrl || '');
      return capture
        ? { ok: true, ...capture }
        : { ok: false, error: 'Selection is no longer available.' };
    }

    if (msg?.action === 'showTranslation') {
      const { error, dictionary, translated, mode, think } = msg.result || {};
      const sLite = await getSettingsLite();
      if (msg.sourceUrl && location.href !== msg.sourceUrl) {
        return { ok: false, error: 'Selection page changed.' };
      }
      const r = takeSelectionRange(
        msg.sourceText || '',
        msg.sourceUrl || '',
        msg.selectionCaptureId || '',
        Number.isInteger(msg.selectionGeneration) ? msg.selectionGeneration : null
      );
      if (msg.sourceText && !r) {
        // Context-menu results belong only to the captured range. Falling back
        // to document.activeElement can write a stale result after navigation.
        return { ok: false, error: 'Selection is no longer available.' };
      }
      if (mode === 'dictionary' && dictionary) {
        renderDictionaryBubble(dictionary, sLite.translationStyle, r);
        return { ok: true };
      }

      const allowPeek = !!sLite.showReasoningPeek;
      const errorText = error ? `Error: ${error}` : null;
      const html = errorText || translated || '';

      if (r) {
        const selectedBlocks = selectedBlocksFromRange(r);
        if (selectedBlocks.length > 1) {
          renderSelectionPopup(r, errorText || translated || '', { think, allowPeek }, sLite.translationStyle);
          window.getSelection()?.removeAllRanges();
          return { ok: true };
        }

        const block = closestBlockFromRange(r);
        const selText = r.toString().trim().replace(/\s+/g, '');
        const blockText = (block?.innerText || '').trim().replace(/\s+/g, '');

        const isFullBlock = block && block !== document.body &&
                            selText.length > 0 &&
                            blockText.length > 0 &&
                            (selText.length / blockText.length > 0.85);

        if (isFullBlock && !errorText) {
          const renderer = await getImmersivePageModule();
          renderer.mountImmersiveTranslation(block, {
            text: translated || '',
            status: 'translated',
            targetLang: sLite.targetLang,
            theme: sLite.translationTheme
          });
        } else {
          renderSelectionPopup(r, errorText || translated || '', { think, allowPeek }, sLite.translationStyle);
        }

        window.getSelection()?.removeAllRanges();
      } else {
        const block = document.activeElement?.closest?.(BLOCK_SELECTOR);
        if (block && !errorText) {
          const renderer = await getImmersivePageModule();
          renderer.mountImmersiveTranslation(block, {
            text: translated || '',
            status: 'translated',
            targetLang: sLite.targetLang,
            theme: sLite.translationTheme
          });
        } else {
          const b = ensureBubble();
          b.textContent = html;
          placeBubble();
          applyTranslationStyle(b, sLite.translationStyle, document.activeElement || document.body);
        }
      }
      return { ok: true };
    }

    if (msg?.action === 'translatePage') {
      await queuePageTranslationToggle();
      return { ok: true };
    }

    if (msg?.action === 'translateImageAtUrl' && msg.srcUrl) {
      const mod = await safeImport('content/imageOverlay.js');
      await mod.translateImageFromUrl(msg.srcUrl);
      return { ok: true };
    }

    return { ok: false, error: 'Unknown content action' };
  })().then(
    response => sendResponse?.(response),
    err => {
      console.error('[IT][content] message failed', err);
      sendResponse?.({ ok: false, error: err?.message || String(err) });
    }
  );
  return true;
});

// ---- YouTube overlay ----
(async () => {
  const onYouTube = /(^|\.)youtube\.com$/.test(location.hostname);
  if (!onYouTube) return;
  try {
    const mod = await safeImport('content/youtube.js');
    mod.initYouTubeOverlay();
  } catch { }
})();

window.addEventListener('pagehide', () => {
  pageDocumentActive = false;
  invalidateSelectionCapture();
  if (!pageTranslationSession) return;
  // BFCache preserves the DOM exactly as it is. Fully restore the source page
  // before it is frozen so a later pageshow never inherits orphan wrappers.
  stopPageTranslation(pageTranslationSession.renderer);
});
window.addEventListener('pageshow', () => {
  pageDocumentActive = true;
});

function esc(s = '') { return String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }
