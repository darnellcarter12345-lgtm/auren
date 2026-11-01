AUREN v2.1.1 — Responsive wake and silence handling

Replace only app.js and voice.js in your existing GitHub repository. Leave index.html, styles.css, ai.js, memory.js, db.js and Cloudflare untouched.

Changes: expanded commonly misheard Hey Auren variants, faster idle sleep (~8.5 s since the last interaction), faster permitted recognition restarts, responsive orb toggle, live interruptions setting takes effect immediately.

Safari limitations: speech recognition is not guaranteed to understand every pronunciation, continuous recognition may still stop, and hands-free interruption during speech is best effort. Keep a visible microphone status. Microphone activation may require a tap after page load.
