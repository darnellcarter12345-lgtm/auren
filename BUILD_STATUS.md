# AUREN — Build Status (v0.2.0, updated 2026-10-31)

## Working (verified by automated tests in a simulated DOM + fake IndexedDB: 83 UI checks + storage-failure test)
- Persistent memory in IndexedDB with write→read-back verification
- Create / edit / delete / search / filter memories; categories; tags
- Sensitive-content gate enforced in the data layer for chat, forms, edits, project names/notes, and imports; credentials/card/SSN-like text always refused
- Strict, tokenised, expiring chat confirmations (no bypass via compound "yes…" or stale buttons)
- Session notes: shown in a panel, used by recall / "what are we working on" / fallback, promotable with "Keep forever", cleared on reload, never persisted or kept in history
- Chat history redaction, on/off switch, 200-message cap, clear button
- Projects: create, progress slider, status, notes, delete
- Backup: export (sensitive omitted by default, optional encryption), defensive import with summary + approval
- Storage status banner, startup health check, storage usage display, "delete everything"
- Navigation across all tabs; mobile-friendly layout

## Planned / NOT built
Voice recognition, TTS, real voice visualization (orb is decorative), LLM conversation, reminders & notifications, daily briefings, research, integrations, sync, semantic search, PWA install, app lock.

## NOT yet verified
- Real-browser behavior (Chrome / Safari / Android / iPhone). Tests used jsdom, not a real browser.
- Deployment to GitHub Pages / Cloudflare Pages.
- Real quota-exceeded behavior (only the error translation is tested).
- Whether iOS Safari evicts IndexedDB after long inactivity (export backups regularly).

## Known limitations
No lock screen; regex classification is imperfect; data is single-device; keyword search only; `confirm()` dialogs are used for destructive actions.

## Voice addition (v0.3.0)
- Browser microphone and spoken responses integrated; not yet verified in iOS Safari or Chrome on a physical device.
- SpeechRecognition is browser-specific and may use remote vendor speech processing.
- Speech synthesis voice availability varies.
- AUREN remains a command-based assistant, not a real LLM chat.
