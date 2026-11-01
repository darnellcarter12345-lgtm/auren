AUREN v2.1 — Simplified wake experience

Replace ONLY index.html, styles.css, app.js, and voice.js in the existing GitHub repository root. Keep all remaining files and your Cloudflare Worker unchanged.

Home shows no personal-butler subtitle or Hey Auren button; idle prompt reads Tap to awaken. Click orb to begin conversation. After 18 seconds of silence, conversation returns to sleep, leaving wake recognition enabled while Safari permits. Say Hey Auren / Hey Oren / Hey Lauren or click orb to wake again. If Safari blocks recognition, tap the orb again.

This cannot activate mic automatically from a fresh page load on Safari, work while tab is closed, or bypass microphone permission. Wake listening uses browser SpeechRecognition and may be restarted by Safari. Settings and memory remain intact.
