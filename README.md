# AUREN v0.2.0
A local-first personal assistant: HTML + CSS + JavaScript + IndexedDB. No server, no build step, no paid services.

## Run on your computer
ES modules do not work by double-clicking index.html. In this folder run:
    python3 -m http.server 8000
then open http://localhost:8000
(Opening it from your phone over Wi-Fi via http://<computer-ip>:8000 works for basic testing, but encrypted backups need https.)

## Deploy free (GitHub Pages)
1. Create a free GitHub account and a new PUBLIC repository (e.g. `auren`). Your memories are NOT in the repository — they stay in each browser — but the code will be public.
2. On the repository page choose "Add file → Upload files", drag in `index.html`, the `css` folder and the `js` folder (the `docs` and `tests` folders are optional), and commit.
3. Repository Settings → Pages → "Deploy from a branch" → branch `main`, folder `/ (root)` → Save.
4. After a minute your site appears at `https://<your-username>.github.io/auren/`.
Cloudflare Pages ("Direct upload") also works. Each browser/device has its own separate data; use Backup to move data.

## Developer tests (optional)
cd tests && npm install && npm test     (needs Node.js; not needed to run AUREN)

## Docs
Start with docs/PROJECT_SPEC.md → BUILD_STATUS.md → NEXT_STEPS.md. Testing: docs/TESTING_CHECKLIST.md.

## Voice (v0.3.0)
Use a supported browser on localhost or HTTPS. Tap **Speak to AUREN** and grant microphone access to dictate a supported command. Check **Read replies aloud** for spoken responses, and **Stop speaking** to cancel audio. The app does not upload or save raw audio, but your browser’s recognition implementation may send it to the browser vendor’s service; consult its privacy settings. Speech recognition is not reliably available in every mobile browser. Text commands remain available. No AI language model is connected yet.


## v0.4 update
Voice-first single-screen interface. Optional foreground wake phrase “Hey Auren” (speech recognition browser dependent). Root files are the GitHub Pages deployment files. Memory and backup continue in IndexedDB. This is command-based, not yet a conversational AI.
