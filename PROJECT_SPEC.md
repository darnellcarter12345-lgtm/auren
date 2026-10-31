# AUREN — Project Spec
*(Read this first in any new Claude conversation, then BUILD_STATUS.md and NEXT_STEPS.md.)*

## Vision
AUREN is a luxurious, voice-first personal AI butler (JARVIS-like) for Darnell. It remembers his interests, projects and goals, organizes his life, gives daily briefings and reminders, and eventually acts proactively on approved tasks.

## Personality
Classic British butler: professional, articulate, calm, discreet, occasionally witty, naturally conversational. Says "sir" when appropriate, not constantly.

## Design
Obsidian #101318 · Graphite #20252C · Champagne gold #D6B57B · Ivory #ECE7DD. Premium, futuristic, penthouse feel. Needs: voice visualization, memory dashboard, reminders, chat history.

## Hard rules
1. Never claim something was saved unless it is verifiably in the database (every save is read back).
2. Sensitive personal info is saved only after explicit confirmation, on EVERY path (chat, forms, edits, imports). Credentials/card/SSN-like data is never stored.
3. Never fake features. Anything unbuilt is labeled PLANNED in the UI and docs.
4. No paid APIs, subscriptions or services without asking Darnell first. Architecture is fixed: HTML + CSS + JavaScript + IndexedDB on free static hosting. No Base44.
5. Claude writes the code; Darnell does account setup, deployment, testing. Give complete files + locations, beginner-friendly steps.
6. Darnell may switch Claude accounts (free plan) — keep the docs current.
7. Keep the app compatible with free static hosting (no server code, no build step).

## Memory requirements
Persistent; categorized; retrievable; editable/deletable; tracks projects and progress; separates temporary session context from long-term memory; confirmation for sensitive info; private; survives closing/reopening.

## Constraints
Claude free plan; ChatGPT Plus (planning/code review — Milestone 1 was reviewed there); $0 budget.

## Current objective (as of 2026-10-31)
Verify and deploy a stable first version (v0.2.0). No paid AI, no advanced voice yet.

## Planned features (none built unless BUILD_STATUS.md says so)
Voice recognition, text-to-speech, LLM conversation, reminders/notifications, scheduled briefings, online research, external integrations, cross-device sync, app lock, PWA install.
