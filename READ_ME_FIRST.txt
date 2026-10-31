AUREN emergency button fix

CAUSE: app.js line 321 contained an unescaped apostrophe in a JavaScript string (I'm), causing a SyntaxError. Because app.js fails to parse, none of AUREN's interface click handlers load.

FIX: upload ONLY app.js from this folder to the ROOT of your EXISTING GitHub repository. Commit changes. Wait for the Pages deployment to finish and refresh the AUREN site.

Do NOT upload this ZIP as the website. Do NOT delete any other files. This change does not modify memory storage, voice.js, Cloudflare Worker, or saved preferences.

Validation: node --check passes on app.js and all uploaded JavaScript modules. Browser testing remains necessary.
