// content/content.js

const api = (globalThis.chrome ?? globalThis.browser);

const TRANSLATION_STYLE_DEFAULTS = {
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Noto Sans, sans-serif',
  fontSize: '14px',
  textColor: '#0f172a',
  bubbleColor: '#ffffff',
  borderColor: '#e2e8f0'
};

// ---- lightweight settings ----
async function getSettingsLite() {
  const v = await api.storage.sync.get(null);
  return {
    targetLang: v.targetLang || 'zh',
    enableWordDictionary: !!v.enableWordDictionary,
    ytBilingualOverlay: !!v.ytBilingualOverlay,
    showReasoningPeek: v.showReasoningPeek !== false, // default: true
    translationStyle: normalizeTranslationStyle(v)
  };
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
  return {
    fontFamily: normalizeFontFamily(v.translationFontFamily),
    fontSize: normalizeFontSize(v.translationFontSize),
    textColor: normalizeColor(v.translationTextColor, TRANSLATION_STYLE_DEFAULTS.textColor),
    bubbleColor: normalizeColor(v.translationBubbleColor, TRANSLATION_STYLE_DEFAULTS.bubbleColor),
    borderColor: normalizeColor(v.translationBorderColor, TRANSLATION_STYLE_DEFAULTS.borderColor)
  };
}

function applyTranslationStyle(el, style) {
  if (!el) return;
  const s = style || TRANSLATION_STYLE_DEFAULTS;
  el.style.fontFamily = s.fontFamily;
  el.style.fontSize = s.fontSize;
  el.style.color = s.textColor;
  el.style.backgroundColor = s.bubbleColor;
  el.style.borderColor = s.borderColor;
  const targets = el.querySelectorAll ? el.querySelectorAll('.tgt') : [];
  targets.forEach(node => { node.style.color = s.textColor; });
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
  .it-inline-translation .tgt{ color:#0f172a; flex-grow:1; }
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
function placeBubble() {
  const sel = window.getSelection();
  const r = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
  const x = (r?.left || 24), y = (r?.bottom || 24);
  bubble.style.left = Math.min(x, window.innerWidth - 380) + 'px';
  bubble.style.top = Math.min(y + 8, window.innerHeight - 220) + 'px';
}
function renderDictionaryBubble(dic, style) {
  const b = ensureBubble(); placeBubble();
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
  applyTranslationStyle(b, style);
  b.querySelector('#it-x')?.addEventListener('click', () => { b.remove(); bubble = null; });
}

// ---- inline rendering + think peek ----
function insertBelow(el, html, meta, style) {
  const holder = document.createElement('div');
  holder.className = 'it-inline-translation';
  holder.innerHTML = `${html}<span class="close">✕</span>`;
  applyTranslationStyle(holder, style);
  el.after(holder);
  holder.querySelector('.close')?.addEventListener('click', () => holder.remove());

  const think = meta?.think;
  if (meta?.allowPeek && think && typeof think === 'string' && think.trim()) {
    const b = document.createElement('button');
    b.className = 'it-think-btn';
    b.title = 'Show reasoning';
    b.textContent = '🧠';
    b.addEventListener('click', () => toggleThinkPopover(holder, think));
    holder.prepend(b);
  }
  return holder;
}
function toggleThinkPopover(holder, thinkText) {
  let pop = holder._thinkPop;
  if (pop) { pop.remove(); holder._thinkPop = null; return; }
  pop = document.createElement('div');
  pop.className = 'it-think-pop';
  pop.textContent = thinkText;
  holder._thinkPop = pop;
  const rect = holder.getBoundingClientRect();
  pop.style.top = (rect.top + window.scrollY + 8) + 'px';
  pop.style.left = (rect.left + window.scrollX + 12) + 'px';
  document.body.appendChild(pop);
}

function renderSelectionPopup(r, text, meta, style) {
  let pop = document.getElementById('it-selection-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'it-selection-pop';
    pop.style.cssText = 'position:absolute;z-index:2147483647;max-width:400px;min-width:200px;background:#fff;border:1px solid rgba(0,0,0,0.08);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.12);padding:14px;font:14px/1.5 system-ui,-apple-system,sans-serif;color:#0f172a;';
    document.body.appendChild(pop);
  }
  
  const rect = r.getBoundingClientRect();
  pop.style.left = Math.min(rect.left + window.scrollX, document.body.scrollWidth - 420) + 'px';
  pop.style.top = (rect.bottom + window.scrollY + 8) + 'px';
  
  const htmlObj = text.startsWith('<div') ? text : `<div>${esc(text)}</div>`;
  
  pop.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div style="flex-grow:1;color:#0f172a;">${htmlObj}</div>
      <span class="close" style="cursor:pointer;opacity:0.4;font-size:14px;line-height:1;margin-top:2px;">✕</span>
    </div>
  `;
  applyTranslationStyle(pop, style);
  const content = pop.querySelector('div > div');
  if (content) content.style.color = style?.textColor || TRANSLATION_STYLE_DEFAULTS.textColor;
  
  pop.querySelector('.close')?.addEventListener('click', () => { pop.remove(); });

  const think = meta?.think;
  if (meta?.allowPeek && think && typeof think === 'string' && think.trim()) {
    const b = document.createElement('button');
    b.className = 'it-think-btn';
    b.title = 'Show reasoning';
    b.textContent = '🧠';
    b.addEventListener('click', () => toggleThinkPopover(pop, think));
    pop.prepend(b);
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
  const quick = doc.querySelector('article, main, [role="main"], [itemprop="articleBody"]');
  if (quick && (quick.innerText || '').trim().length > 200) return quick;

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
  const sel = 'p, li, blockquote, h1,h2,h3,h4,h5,h6, figcaption, td, th';
  const all = Array.from(root.querySelectorAll(sel));
  return all.filter(el => {
    if (!el.innerText) return false;
    const txt = el.innerText.trim();
    if (txt.length < 2) return false;
    if (el.nextElementSibling?.classList?.contains('it-inline-translation')) return false;
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
    const intersects = r.compareBoundaryPoints(Range.END_TO_START, nr) < 0 &&
      r.compareBoundaryPoints(Range.START_TO_END, nr) > 0;
    nr.detach?.();
    return intersects;
  });
}

// ---- page translation ----
async function translatePageInline() {
  const sLite = await getSettingsLite();
  const root = pickMainRoot(document);
  let blocks;

  if (root) {
    blocks = collectBlocks(root);
    if (blocks.length < 3) blocks = collectBlocks(document);
  } else {
    blocks = Array.from(document.querySelectorAll(
      'article p, article li, main p, main li, p, li, blockquote, h1,h2,h3,h4,h5,h6, figcaption, td, th'
    )).filter(el => el?.innerText && el.innerText.trim().length > 0 && !el.nextElementSibling?.classList?.contains('it-inline-translation'));
  }

  if (!blocks.length) return;

  const CHUNK = 40;
  const SEP = '\n\u2063\u2063\u2063\n';
  for (let i = 0; i < blocks.length; i += CHUNK) {
    const slice = blocks.slice(i, i + CHUNK);
    const srcs = slice.map(el => el.innerText.trim());
    const resp = await api.runtime.sendMessage({
      action: 'translateText',
      text: srcs.join(SEP),
      targetLang: sLite.targetLang,
      intent: 'page'
    }).catch(() => null);
    if (!resp?.ok) continue;
    const parts = (resp.result?.translated || '').split(SEP);
    slice.forEach((el, idx) => insertBelow(el, htmlForTargetOnly(parts[idx] || ''), { allowPeek: false }, sLite.translationStyle));
  }
}

// ---- message handling ----
api.runtime.onMessage.addListener(async (msg) => {
  if (msg?.action === 'showTranslation') {
    const { error, dictionary, translated, mode, think } = msg.result || {};
    const sLite = await getSettingsLite();
    if (mode === 'dictionary' && dictionary) { renderDictionaryBubble(dictionary, sLite.translationStyle); return; }

    const r = (getSelection() && getSelection().rangeCount) ? getSelection().getRangeAt(0) : null;
    const allowPeek = !!sLite.showReasoningPeek;
    const errorText = error ? `Error: ${error}` : null;
    const html = errorText ? `Error: ${errorText}` : (translated || '');

    if (r) {
      const selectedBlocks = selectedBlocksFromRange(r);
      if (selectedBlocks.length > 1) {
        const SEP = '\n\u2063\u2063\u2063\n';
        const srcs = selectedBlocks.map(el => el.innerText.trim()).filter(Boolean);
        if (srcs.length > 1) {
          const multiResp = await api.runtime.sendMessage({
            action: 'translateText',
            text: srcs.join(SEP),
            targetLang: sLite.targetLang,
            intent: 'selection'
          }).catch(() => null);
          if (multiResp?.ok) {
            const parts = (multiResp.result?.translated || '').split(SEP);
            selectedBlocks.forEach((el, idx) => insertBelow(el, htmlForTargetOnly(parts[idx] || ''), { think, allowPeek }, sLite.translationStyle));
            window.getSelection()?.removeAllRanges();
            return;
          }
        }
      }

      const block = closestBlockFromRange(r);
      const selText = r.toString().trim().replace(/\s+/g, '');
      const blockText = (block.innerText || '').trim().replace(/\s+/g, '');
      
      const isFullBlock = block && block !== document.body && 
                          selText.length > 0 && 
                          blockText.length > 0 && 
                          (selText.length / blockText.length > 0.85);

      if (isFullBlock) {
        insertBelow(block, htmlForTargetOnly(html), { think, allowPeek }, sLite.translationStyle);
      } else {
        renderSelectionPopup(r, errorText || translated || '', { think, allowPeek }, sLite.translationStyle);
      }
      
      window.getSelection()?.removeAllRanges();
    } else {
      const block = document.activeElement || document.body;
      insertBelow(block, htmlForTargetOnly(html), { think, allowPeek }, sLite.translationStyle);
    }
  }

  if (msg?.action === 'translatePage') {
    try { await translatePageInline(); } catch (e) { console.error('[inline] translatePage failed', e); }
  }

  if (msg?.action === 'translateImageAtUrl' && msg.srcUrl) {
    try {
      const mod = await safeImport('content/imageOverlay.js');
      mod.translateImageFromUrl(msg.srcUrl);
    } catch (e) { console.warn('[IT] image overlay not available', e); }
  }
});

// ---- YouTube overlay ----
(async () => {
  const onWatch = /(^|\.)youtube\.com$/.test(location.hostname) && location.pathname.startsWith('/watch');
  if (!onWatch) return;
  const s = await getSettingsLite();
  if (!s.ytBilingualOverlay) return;
  try {
    const mod = await safeImport('content/youtube.js');
    mod.initYouTubeOverlay();
  } catch { }
})();

function esc(s = '') { return String(s).replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m])); }
