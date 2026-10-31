AUREN v0.7 — Conversational AI connection

1) EXISTING GITHUB REPO: upload ONLY these 3 files to the same ROOT folder:
   index.html, app.js, ai.js
   Keep all existing memory, voice, CSS, backup and other JavaScript files.
   DO NOT upload cloudflare-worker.js to GitHub Pages for execution.

2) CLOUDFLARE SETUP (free plan):
   - Go to https://dash.cloudflare.com and create/sign in to a Cloudflare account.
   - Workers & Pages > Create > Worker. Name it auren-ai.
   - Click Edit Code; replace the Worker script with cloudflare-worker.js.
   - In the Worker's Settings/Bindings add a Workers AI binding, named EXACTLY AI.
   - Deploy.
   - Copy your Worker HTTPS URL (such as https://auren-ai.example.workers.dev).

3) AUREN WEBSITE:
   - Open https://darnellcarter12345-lgtm.github.io/auren/
   - Open Memory & settings > Backup tab.
   - Paste the workers.dev address into 'Connect AUREN's AI brain' and click Connect AI.
   - Ask 'What are some ways to organize my projects?' and AUREN should reply naturally.
   - For memories, continue using explicit 'remember that...' commands.

IMPORTANT:
- AUREN does NOT train its own model: it uses Cloudflare's hosted Llama model.
- The current voice is still browser speech synthesis. AI connection alone DOES NOT fix speaker problems.
- In Safari, test 'Hear AUREN's voice' and check device volume/output.
- Cloudflare Workers AI has a capped daily free allowance, not unlimited free usage.
- The Worker is a prototype protected by an Origin check, which is NOT authentication.
  Anyone can forge Origin in a non-browser request. Do not treat it as private or secure for public use.
  Avoid sensitive conversation data; only relevant non-sensitive memory is sent automatically.
- Do NOT put passwords, API secrets, or personal data into your public GitHub files.
- This bundle has syntax checks but is not yet tested on your Cloudflare account or device.
