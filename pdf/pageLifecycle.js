export function disposePdfPageState(state, releasePage = () => {}) {
  if (!state) return;
  if (state.disposeTimer) clearTimeout(state.disposeTimer);
  state.disposeTimer = null;
  state.generation += 1;
  state.controller?.abort();
  state.controller = null;
  state.status = 'idle';

  for (const canvas of [state.sourceCanvas, state.targetCanvas]) {
    if (!canvas) continue;
    canvas.width = 1;
    canvas.height = 1;
  }
  state.textLayer?.replaceChildren();
  state.translationLayer?.replaceChildren();
  state.message?.replaceChildren();
  if (state.message?.dataset) state.message.dataset.visible = 'false';
  releasePage(state.pageNumber);
}

/** Stop queued/rendering/OCR/translation work as soon as a page leaves the
 * generous observer margin, while keeping its already-rendered pixels until
 * the delayed heavy-state disposal runs. */
export function deactivatePdfPageState(state) {
  if (!state) return;
  state.generation += 1;
  state.controller?.abort();
  state.controller = null;
  state.status = 'idle';
}

export function activatePdfPageState(state, schedule) {
  if (!state) return;
  if (state.disposeTimer) clearTimeout(state.disposeTimer);
  state.disposeTimer = null;
  schedule(state);
}
