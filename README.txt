AUREN v2.0.5 — Combined v2.0.4 routing + memory-dispute handling.

Required: replace ONLY app.js in your existing GitHub repository root and commit. No need to install v2.0.4 separately. All other website files remain unchanged.

Optional: For more consistent handling of disputed memories in ordinary AI conversations, replace the script in your EXISTING Cloudflare Worker with cloudflare-worker.js and Deploy. Do NOT upload the Worker file as a GitHub Pages script. Keep the existing AI binding.

Test: save "I like trading" in Memory. Ask "I never told you I like trading." AUREN should acknowledge the saved record without pretending to know who originally entered it. Then ask for a recommendation and check normal Cloudflare AI replies still work.

Limitations: AUREN still cannot prove who said a saved fact. Browser-based voice and Cloudflare responses need Safari testing. This is not an AI model upgrade.
