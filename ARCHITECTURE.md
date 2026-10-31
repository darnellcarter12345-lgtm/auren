# AUREN — Architecture (v0.2.0)

## Decision: local-first static web app, $0
- **Frontend:** plain HTML/CSS/JavaScript ES modules. No build step, no framework, no npm needed to run.
- **Database:** IndexedDB in the browser. Data stays on the user's device (private by default, but see "Privacy model").
- **Hosting:** any free static host (GitHub Pages / Cloudflare Pages). HTTPS needed for encryption, voice, notifications.
- **Backend:** none yet; added only when a feature truly needs one (sync, push reminders, hiding API keys).

## Why not Base44 (researched Oct 31, 2026; re-verify before relying)
Free plan ≈ 25 message credits/month with a daily cap and no in-app code editing; ZIP/GitHub export needs the Builder plan (~$40–50/mo); no evidence of importing/deploying externally written code. Unsuitable for $0 Claude-written code.

## Module map
- `js/db.js` IndexedDB wrapper; `saveVerified`/`deleteVerified` (write, read back, compare); friendly storage errors (quota, blocked, closed DB); `healthCheck()` at startup; `uid()` with fallback for non-secure pages.
- `js/sensitive.js` the ONE gate: `classify`, `gate`, `BlockedContentError`, `NeedsConfirmationError`, `historySafe`.
- `js/memory.js` memory CRUD + keyword search. Gate is enforced inside create/update (callers cannot bypass). Edits re-gate when text/tags change.
- `js/projects.js` projects; names and notes gated; `updateProject` only changes progress/status.
- `js/butler.js` rule-based command interpreter; session notes; tokenised, expiring, strict yes/no confirmations; `getContext()` is the hook for a future LLM; `fallback()` is where the LLM plugs in.
- `js/backup.js` export (sensitive omitted by default, optional AES-GCM encryption with PBKDF2) and defensive import validation.
- `js/settings.js` on/off switches in localStorage (never holds memories).
- `js/app.js` UI wiring, status banner, history redaction, session panel.
- `tests/` developer-only Node tests (jsdom + fake-indexeddb); not part of the deployed app.

## Data model (IndexedDB `auren`, version 1)
- `memories`: {id, text(≤2000), category, tags[≤20, each ≤40], sensitive, createdAt, updatedAt, lastRecalledAt}
- `projects`: {id, name(≤200), status active|paused|done, progress 0-100, notes[{at,text(≤1000),sensitive}] (≤200), sensitive, createdAt, updatedAt}
- `messages`: {id, role user|auren, text, at} — chat history; last 200 kept; probe record `__probe__` used by startup health check.
- Session notes: in-memory array in `Butler` (max 20, ≤500 chars). Never written to disk. Used by recall, "what are we working on", fallback, and `getContext()`.
Categories: preference, interest, goal, project, person, routine, fact, other.

## Privacy model
- Everything lives unencrypted in this browser profile's IndexedDB. No lock screen yet (PLANNED). Anyone with access to the profile can read it.
- Chat history on disk is redacted: any message (user or AUREN) that classifies as sensitive/blocked, and any session-note message, is stored as a placeholder. The live on-screen log still shows real text until reload. History can be switched off and is capped at 200 messages. History is never exported.
- Sensitive memories are excluded from backups by default. Including them without a passphrase requires an extra confirmation. Passphrase → AES-GCM-256 (PBKDF2-SHA256, 210k iterations). Lost passphrase = unrecoverable.
- Classification is regex-based (heuristic). It can miss sensitive content and can over-flag. It is a safety net, not a guarantee.
- "Delete everything" (typed DELETE) wipes all three stores.
- All dynamic text is inserted with `textContent` (no HTML injection).

## Confirmation design
Sensitive saves throw `NeedsConfirmationError` from the data layer; chat/UI catch it and ask. Chat confirmations carry a one-time token, expire after 2 minutes, and accept only a bare "yes"/"no" (so "yes, also remember X" confirms nothing); stale buttons cannot confirm a newer question.

## Import validation
Treated as untrusted: ≤5 MB, valid JSON, `app==='AUREN'`, integer version ≤1, record counts capped, ids must match `[A-Za-z0-9_-]{8,64}`, field types/lengths checked, records rebuilt from a whitelist (extra keys like `__proto__` dropped), dates/categories repaired, blocked content skipped, sensitive content re-flagged, newer local copies never overwritten, user approves a summary before any write, writes are verified.

## Storage-problem display
Sticky dismissible banner (errors persist; info/ok auto-hide). Startup health check proves write→read→delete works; if not, header and banner say nothing will be saved. Quota, private-mode, blocked-upgrade and closed-DB errors are translated to plain English.

## Planned integration points (NOT built)
Voice (Web Speech API, `js/voice.js`); AI (`js/llm.js` provider interface — ask Darnell before choosing any provider); reminders (`js/reminders.js`, service worker); optional free-tier sync backend; PWA install; app lock.
