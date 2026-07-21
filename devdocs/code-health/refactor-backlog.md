# Refactor Backlog

## Next

No high-confidence code refactor is currently recommended. Re-audit after the
release and real-browser QA items below produce new evidence.

## Later

- [ ] CH-014: Run a representative live real-PDF/browser matrix; verify layout, caches, disposal/re-entry, retry, zoom, queued-versus-started OCR behavior, and memory before prioritizing search, outline, annotation, export, or password support.
- [ ] CH-013: Define a trustworthy companion download/artifact channel; then exercise the ZIP, SHA-256, npm ci, exact-ID install, registry, native-message, ChatGPT login, multi-batch task context, automatic/custom models, cancellation/rotation, logout, and uninstall flow.
- [ ] CH-015: Decide whether silent History round trips on browsers without Navigation API justify the `webNavigation` permission; then run delayed-provider, rapid/same-document navigation, cross-frame selection (including Chrome opaque related frames), relevant DOM mutation, BFCache, PDF, YouTube, Chrome AI, and Codex cancellation scenarios in live Chrome/Firefox sessions.
- [ ] CH-012: Promote transient UI ownership from mitigated to resolved after repeated page mutation, open/close, resize, replacement, and target-removal browser checks.
- [ ] CH-004: Centralize the repeated manifest version only if the current mismatch gates prove insufficient or manual drift recurs.

## Blocked

- CH-012 requires a live browser session for its remaining lifecycle evidence.
- CH-014 requires a chosen browser and representative non-sensitive real PDF fixtures.
- CH-013 has no trustworthy published companion URL/artifact channel and also lacks an exact unpacked Chrome/Edge extension ID and signed-in end-to-end environment.
- CH-015 requires controllably delayed providers and live browser sessions.

## Resolved

- [x] CH-001: Shared and tested dictionary response normalization.
- [x] CH-002: Stored prompt keys and runtime-input-preserving override semantics.
- [x] CH-003: Debug-gated, content-safe logging.
- [x] CH-005: Explicit provider capabilities, deterministic fallback, and bounded public DTO.
- [x] CH-006: Shared exact-cardinality batch translation contract.
- [x] CH-007: Shared effective settings contract in the content path.
- [x] CH-008: Singleton, generation-aware YouTube SPA/settings/BFCache lifecycle with same-video event coalescing and cue-gap clearing.
- [x] CH-009: Idempotent secret migration to local storage and password inputs.
- [x] CH-010: Explicit, permissioned, documented Tesseract language-data boundary.
- [x] CH-011: One documented syntax, identity, and behavior verification gate.

## Mitigated

- [~] CH-004: Manifests and build gates agree on 3.2.0 and stale `dist/` output is gone; the version remains repeated across three manifests.
- [~] CH-012: Image/reasoning UI has explicit disposal, and full-page discovery/mutation/retry work shares one unique DOM-ordered drain that clears on teardown; live browser lifecycle evidence is pending.
- [~] CH-013: Isolated ChatGPT CODEX_HOME, environment allowlisting, protocol-v2 Native Messaging, fail-closed global serialization, bounded per-task thread reuse, first-turn-only full prompts, explicit model selection, poisoned-session disposal, and locked/versioned delivery mechanics are statically tested; trustworthy publication and the complete installed signed-in flow remain pending.
- [~] CH-015: Sender-owned request IDs, shared cancellation, AbortSignal propagation, stale guards, platform-aware frame targeting, exact capture IDs/generations, live Range mutation plus ancestor detach/restore invalidation, observable same-document navigation, and BFCache safety are statically tested; silent History round trips without Navigation API and live slow-network/browser ordering remain pending.
