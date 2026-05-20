import { getSettings } from '../core/settings.js';
const api = (globalThis.browser ?? globalThis.chrome);

let rafId = 0, overlay, currentCues = [], lastIdx = -1;
const NAV_EVENT = 'yt-navigate-finish';

export async function initYouTubeOverlay() {
  const apply = async () => {
    const s = await getSettings();
    if (!s.ytBilingualOverlay) { unmountOverlay(); return; }
    await setupForCurrentVideo();
  };
  await apply();
  function onNav(){ setTimeout(apply, 300); }
  window.removeEventListener(NAV_EVENT, onNav);
  window.addEventListener(NAV_EVENT, onNav);
}

function getPlayerResponse() {
  const host = document.querySelector('ytd-watch-flexy');
  const attr = host?.getAttribute?.('player-response');
  if (attr) { try { return JSON.parse(attr); } catch {} }
  const obj = host?.playerResponse || host?.__data?.playerResponse;
  if (obj) return obj;
  return window.ytInitialPlayerResponse || null;
}
function pickTrack(tracks) { const manual = tracks.find(t => t.kind !== 'asr'); return manual || tracks[0]; }
function normalizeEvents(evts = []) {
  return evts.filter(e=>e?.segs?.length).map(e=>{
    const text = e.segs.map(s=>s.utf8||'').join('').replace(/\s+/g,' ').trim();
    return { start: e.tStartMs, end: e.tStartMs + (e.dDurationMs || 2000), text };
  }).filter(c=>c.text);
}
async function fetchJsonTrack(baseUrl, { tlang } = {}) {
  const u = new URL(baseUrl); if (!u.searchParams.has('fmt')) u.searchParams.set('fmt','json3'); if (tlang) u.searchParams.set('tlang', tlang);
  const res = await fetch(u.toString(), { credentials: 'same-origin' });
  if (!res.ok) throw new Error('timedtext fetch ' + res.status);
  return await res.json();
}
function alignByTime(srcCues, tgtCues) {
  let j = 0; const out = [];
  for (let i=0;i<srcCues.length;i++){
    const s = srcCues[i];
    while (j+1 < tgtCues.length && Math.abs(tgtCues[j+1].start - s.start) < Math.abs(tgtCues[j].start - s.start)) j++;
    const t = tgtCues[j] || {};
    out.push({ start: s.start, end: s.end, src: s.text, tgt: t.text || '' });
  } return out;
}
async function providerTranslateCues(cues, targetLang) {
  const SEP = '\n\u2063\u2063\u2063\n';
  const CHUNK = 40;
  let allParts = [];
  
  for (let i = 0; i < cues.length; i += CHUNK) {
    const slice = cues.slice(i, i + CHUNK);
    const blob = slice.map(c => c.text).join(SEP);
    const resp = await api.runtime.sendMessage({ action:'translateText', text: blob, targetLang });
    if (!resp?.ok) {
      console.warn('[IT] YouTube chunk translation failed:', resp?.error);
      allParts.push(...Array(slice.length).fill(''));
      continue;
    }
    const parts = (resp.result?.translated || '').split(SEP);
    allParts.push(...parts);
  }
  
  return cues.map((c, i) => ({ start: c.start, end: c.end, text: allParts[i] || '' }));
}
function mountOverlay() {
  unmountOverlay();
  overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute; left:0; right:0; bottom:10%; margin:auto; width:96%; text-align:center; pointer-events:none; font-family: system-ui,-apple-system,Segoe UI,Roboto,Noto Sans,sans-serif; text-shadow:0 2px 6px rgba(0,0,0,.6); z-index:2147483647;';
  const player = document.querySelector('.html5-video-player') || document.querySelector('#movie_player');
  (player || document.body).appendChild(overlay);
}
function unmountOverlay(){ if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay); overlay=null; lastIdx=-1; currentCues=[]; if (rafId) cancelAnimationFrame(rafId); }
function renderCue(cue) {
  if (!overlay) return;
  overlay.innerHTML = `<div style="display:inline-block;background:rgba(0,0,0,.55);border-radius:8px;padding:6px 10px;max-width:90%;">
    <div style="color:#fff;font-size:18px;line-height:1.25;">${escapeHTML(cue.src)}</div>
    <div style="color:#b7e3ff;font-size:18px;line-height:1.25;margin-top:2px;">${escapeHTML(cue.tgt)}</div>
  </div>`;
}
function escapeHTML(s=''){ return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }
function startTicker() {
  const video = document.querySelector('video.html5-main-video') || document.querySelector('video');
  if (!video) return;
  const n = currentCues.length;
  const step = () => {
    const t = (video.currentTime || 0) * 1000;
    let idx = lastIdx;
    if (idx < 0 || t < currentCues[idx]?.start || t > currentCues[idx]?.end) idx = binarySearchCue(currentCues, t);
    if (idx !== lastIdx && idx >= 0 && idx < n) { lastIdx = idx; renderCue(currentCues[idx]); }
    rafId = requestAnimationFrame(step);
  };
  step();
}
function binarySearchCue(list, t) {
  let lo=0, hi=list.length-1, mid;
  while (lo<=hi){ mid=(lo+hi)>>1; const c=list[mid];
    if (t < c.start) hi=mid-1; else if (t > c.end) lo=mid+1; else return mid;
  } return -1;
}
async function setupForCurrentVideo() {
  unmountOverlay();
  const s = await getSettings(); 
  const target = s.targetLang || 'zh'; 
  const preferBuiltin = s.ytPreferBuiltIn !== false;
  
  const pr = getPlayerResponse(); 
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return;
  const track = pickTrack(tracks);
  const srcData = await fetchJsonTrack(track.baseUrl); const srcCues = normalizeEvents(srcData.events);
  let tgtCues;
  async function tryBuiltin(){ if (track.isTranslatable === false) return null; try{ const tgtData = await fetchJsonTrack(track.baseUrl, { tlang: target }); const arr = normalizeEvents(tgtData.events); return arr.length?arr:null; } catch { return null; } }
  async function tryApi(){ try{ const arr = await providerTranslateCues(srcCues, target); return arr?.length?arr:null; } catch { return null; } }
  tgtCues = preferBuiltin ? (await tryBuiltin() || await tryApi()) : (await tryApi() || await tryBuiltin());
  if (!tgtCues) return;
  const cues = alignByTime(srcCues, tgtCues);
  mountOverlay(); currentCues = cues; startTicker();
}
