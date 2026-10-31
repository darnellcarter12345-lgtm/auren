// No fake-indexeddb here: IndexedDB is genuinely absent, like a browser that blocks storage.
import { JSDOM } from 'jsdom';
import fs from 'fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dom = new JSDOM(html, { url: 'http://localhost/' }); const w = dom.window, doc = w.document;
Object.assign(globalThis, { window: w, document: doc, localStorage: w.localStorage, Option: w.Option, alert() {}, confirm: () => true });
await import('../js/app.js'); await new Promise(r => setTimeout(r, 300));
const bar = doc.getElementById('statusBar');
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };
ok(/storage problem/.test(doc.getElementById('status').textContent), 'header says storage problem');
ok(!bar.hidden && bar.className === 'error', 'error banner visible and sticky');
ok(/will not save anything/.test(doc.getElementById('statusMsg').textContent), 'banner explains nothing will be saved');
// chat must not pretend to save
doc.getElementById('chatInput').value = 'remember that I like tea';
doc.getElementById('chatForm').dispatchEvent(new w.Event('submit', { cancelable: true }));
await new Promise(r => setTimeout(r, 300));
const texts = [...doc.querySelectorAll('#log .msg')].map(d => d.textContent).join('\n');
ok(!/verified in the database/.test(texts), 'never claims a save when storage is down');
console.log(bad ? 'FAILED' : 'storage-failure test passed'); process.exit(bad ? 1 : 0);
