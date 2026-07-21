# Code Health

This directory records evidence-backed maintainability work for the project.

Current source version: **Adaptive Translation 3.2.0**. The 3.2.0 version was
assigned on 2026-07-21 after reconciling the local source against the older
GitHub `v3` branch at commit `a64adc0`.

- Latest audit: `audits/2026-07-16-audit.md`
- Machine-readable findings: `code-health-register.json`
- Ordered follow-up work: `refactor-backlog.md`

The 2026-07-16 cleanup closed the prompt, logging, provider-contract, batch,
settings, secret-storage, OCR-boundary, verification-gate, and YouTube lifecycle
findings. PDF OCR now drops queued cancelled work while reusing an already-started
per-page task, and context-menu selection ownership is bound to the exact frame,
capture, live Range, navigation generation, and relevant DOM mutations. Release
identity/artifact handling, transient UI ownership, Codex delivery, PDF runtime
parity, and cross-surface cancellation boundaries remain recorded explicitly.
Full-page translation now drains one unique DOM-ordered queue, while Codex keeps
one bounded serial conversation per webpage, opened PDF, or YouTube task and
sends the complete translation preferences only on a physical thread's first
turn. Duplicate YouTube events retain the current video task, and PDF BFCache
transitions close and rebuild the task context while preserving lightweight
page caches. Codex model selection is explicit: automatic or a strictly
validated exact custom ID. Blank model output poisons its thread, and host
shutdown retries temporary-workspace cleanup after active turns settle.
No known high-confidence code refactor is currently recommended; the remaining
work is publication and real-device/browser QA.

Run the zero-install verification gate from the project root:

```powershell
.\tools\verify.ps1
```

If `node` is not on `PATH`, pass its executable with `-NodePath`. The recorded
2026-07-16 run identified Adaptive Translation 3.1.0, parsed 15 JSON and 9
PowerShell files, syntax-checked 69 JavaScript files, and passed 119 tests across
all 18 test files. Live browser, provider-network, OCR-download,
native-companion install, and store-validator checks remain separate
environment-level QA.

No Git metadata was available in this source snapshot during the original
audit, so change-frequency scores remain conservative unless repeated generated
artifacts provided direct evidence. Impact scores are historical severity
baselines; current disposition is represented by each finding's status,
evidence, verification, blockers, and notes.
