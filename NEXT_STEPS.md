# Next Steps
1. **Darnell:** run docs/TESTING_CHECKLIST.md on desktop AND phone; report anything that fails.
2. **Deploy v0.2.0** to a free static host (GitHub Pages or Cloudflare Pages) — steps in README.md. Re-run the checklist on the deployed https URL (also confirms encrypted export works there).
3. **Stabilize:** fix whatever the real-browser test finds. Do not start Milestone 2 until the checklist passes on deployed hosting.
4. **Milestone 2 (memory polish):** duplicate detection, memory review inbox, pinned memories, app lock (passphrase) to address the no-lock-screen limitation.
5. **Milestone 3:** voice (Web Speech API) + real voice visualization.
6. **Milestone 4:** reminders (in-app first), then notifications.
7. **Milestone 5:** LLM integration — choose a free provider WITH Darnell first; wire it into `Butler.fallback()` using `getContext()`.
8. Later: daily briefings, research, optional sync, PWA install.

## Voice QA
1. Serve from localhost or HTTPS, allow microphone permission and press Speak to AUREN.
2. Say "remember that I prefer dark mode" and confirm memory is saved.
3. Enable Read replies aloud; speak "what do you remember about dark mode?" and listen for reply.
4. Test Stop speaking and Stop listening.
5. Test with permission denied and an unsupported browser: text must still work.
6. Confirm microphone recognition does not start automatically.
