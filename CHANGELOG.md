# Changelog
## 0.2.0 — 2026-10-31 (hardening pass, after external review of 0.1.0)
Privacy: history redaction + on/off + 200 cap; sensitive memories excluded from exports by default; optional passphrase encryption; "Delete everything".
Confirmation: gate moved into the data layer (create/update memories, project names/notes); edits re-checked; strict yes/no; one-time tokens + 2-minute expiry; stale buttons harmless.
Session notes: panel, recall integration, "what are we working on", "Keep forever", `getContext()` hook.
Import: full defensive validation, whitelist rebuild, limits, approval summary, newer-local-wins.
Storage: sticky status banner, startup health check, friendly errors, usage display, `uid()` fallback for http testing.
Mobile: banner, 16px inputs, wider tap targets. Tests: 83-check UI suite + storage-failure test (developer-only, `tests/`).
Fixes: project updates can no longer alter names/notes without the gate; moving a finished project's slider below 100% makes it active again.
## 0.1.0 — 2026-10-31
Initial memory system, projects, sensitivity checks, rule-based butler, UI, backup/restore, five docs. Base44 rejected.

## v0.3.0 — Optional browser voice
- Microphone dictation through SpeechRecognition where supported.
- Spoken AUREN responses using speechSynthesis and a preferred English (UK) voice when available.
- Voice toggle and stop controls, with typed-command fallback.
- Does not add a language model, cloud sync, reminders, or audio storage.
