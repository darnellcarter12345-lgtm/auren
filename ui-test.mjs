import 'fake-indexeddb/auto';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import { resolveObjectURL } from 'buffer';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL:', m); } };

let confirmAnswer = true, confirms = [], downloads = [];
let dom, w, doc, bootN = 0;
let lsSnapshot = {};
async function boot() {
  if (w) { lsSnapshot = {}; for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); lsSnapshot[k] = w.localStorage.getItem(k); } }
  dom = new JSDOM(html, { url: 'http://localhost/' });
  w = dom.window; doc = w.document;
  for (const [k, v] of Object.entries(lsSnapshot)) w.localStorage.setItem(k, v);   // a real browser keeps localStorage across reloads
  w.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, name: this.download }); };
  Object.assign(globalThis, { window: w, document: doc, localStorage: w.localStorage, Option: w.Option,
    alert: () => {}, confirm: m => { confirms.push(m); return confirmAnswer; } });
  await import(`../js/app.js?r=${++bootN}`);
  await sleep(400);
}
const $ = id => doc.getElementById(id);
const logTexts = () => [...doc.querySelectorAll('#log .msg')].map(d => d.textContent);
const lastMsg = () => logTexts().at(-1) || '';
const status = () => ({ hidden: $('statusBar').hidden, text: $('statusMsg').textContent, cls: $('statusBar').className });
async function chat(text) { $('chatInput').value = text; $('chatForm').dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true })); await sleep(250); }
const tab = async name => { doc.querySelector(`nav button[data-tab=${name}]`).click(); await sleep(150); };
const submit = async f => { f.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true })); await sleep(250); };
const dbMods = await import('../js/db.js'); const Mem = await import('../js/memory.js'); const Proj = await import('../js/projects.js');
const Backup = await import('../js/backup.js');
const mems = () => Mem.listMemories();

async function importFile(content, passphrase = '') {
  const input = $('importFile'); const s = typeof content === 'string' ? content : JSON.stringify(content);
  Object.defineProperty(input, 'files', { value: [{ size: Buffer.byteLength(s), text: async () => s }], configurable: true });
  $('impPass').value = passphrase; input.dispatchEvent(new w.Event('change')); await sleep(600);
}
async function lastDownload() { const d = downloads.at(-1); return { name: d.name, text: await resolveObjectURL(d.href).text() }; }

console.log('1. startup + navigation');
await boot();
ok($('status').textContent === 'memory online', 'status shows memory online');
ok(logTexts().length === 1 && /Good day/.test(lastMsg()), 'welcome message shown');
for (const t of ['memory', 'projects', 'reminders', 'settings', 'chat']) {
  await tab(t);
  const active = [...doc.querySelectorAll('.tab.active')].map(s => s.id);
  ok(active.length === 1 && active[0] === t, `tab ${t} shows only its section`);
}
ok(/PLANNED/.test($('reminders').textContent), 'reminders labelled planned');

console.log('2. chat memory + strict confirmation');
await chat('remember that I prefer dark mode interfaces');
ok(/verified in the database/.test(lastMsg()), 'normal save verified');
await chat('remember that I take medication for allergies');
ok(/personal information/.test(lastMsg()) && doc.querySelectorAll('#log button').length === 2, 'sensitive asks with Yes/No buttons');
ok((await mems()).length === 1, 'nothing saved before confirmation');
const staleYes = [...doc.querySelectorAll('#log button')][0];
await chat('yes, also remember that my password is hunter2');
ok((await mems()).length === 1, 'compound "yes, ..." does NOT confirm');
staleYes.click(); await sleep(250);
ok(/expired/.test(lastMsg()) && (await mems()).length === 1, 'stale Yes button cannot confirm anything');
await chat('remember that I take medication for allergies');
await chat('yes');
ok((await mems()).length === 2 && (await mems()).some(m => m.sensitive), 'typed "yes" saves sensitive memory, flagged sensitive');
await chat('remember that I take medication for allergies');
[...doc.querySelectorAll('#log button')].at(-1).click(); await sleep(250);
ok(/Nothing was changed/.test(lastMsg()) && (await mems()).length === 2, 'No button cancels');
await chat('remember my password is hunter2');
ok(/decline/.test(lastMsg()) && (await mems()).length === 2, 'credentials refused');
await chat('yes');
ok(/nothing awaiting/.test(lastMsg()), 'stray yes with nothing pending is harmless');
await chat('what do you remember about dark mode?');
ok(/dark mode/.test(lastMsg()), 'recall works');
await chat('forget dark mode');
ok(doc.querySelectorAll('#log button').length >= 2, 'forget asks for confirmation'); 
await chat('no');
ok((await mems()).some(m => /dark mode/.test(m.text)), 'forget cancelled keeps memory');

console.log('3. session notes');
await chat("for now, I'm editing the ebook cover");
ok($('sessionList').textContent.includes('ebook cover'), 'session panel lists note');
ok(!(await mems()).some(m => /ebook/.test(m.text)), 'session note not in long-term memory');
await chat('what do you remember about the ebook cover');
ok(/this conversation, temporary/.test(lastMsg()), 'recall surfaces session note');
await chat('what are we working on');
ok(/ebook cover/.test(lastMsg()), 'overview lists session note');
await chat('hmm the ebook cover again');
ok(/ebook cover/.test(lastMsg()), 'fallback uses session note');
const keep = doc.querySelector('#sessionList button'); keep.click(); await sleep(300);
ok((await mems()).some(m => /ebook cover/.test(m.text)), '"Keep forever" promotes note to long-term memory');
await chat('clear session');
ok(doc.querySelectorAll('#sessionList .snote').length === 0, 'clear session empties panel');
await chat('for now, secret plan alpha');

console.log('4. privacy of chat history (reload)');
await boot();
const hist = logTexts().join('\n');
ok(!/medication|hunter2|alpha/.test(hist), 'sensitive text, passwords and session notes not in saved history');
ok(/not kept in history|withheld/.test(hist), 'placeholders shown instead');
ok(/prefer dark mode/.test(hist), 'ordinary messages are kept');
ok($('sessionList').textContent.includes('None'), 'session notes gone after reload');
await tab('settings'); $('saveHistory').checked = false; $('saveHistory').dispatchEvent(new w.Event('change')); await sleep(50);
await tab('chat'); await chat('remember that my favourite colour is teal');
await boot();
ok(!/teal/.test(logTexts().join('\n')), 'history off: message not saved');
ok($('saveHistory').checked === false, 'history setting persists');
await tab('settings'); $('saveHistory').checked = true; $('saveHistory').dispatchEvent(new w.Event('change'));

console.log('5. memory form');
await tab('memory');
$('memText').value = 'My doctor visit is on Friday'; confirmAnswer = false; confirms = [];
await submit($('memForm'));
ok(confirms.length === 1 && !(await mems()).some(m => /doctor/.test(m.text)), 'form: sensitive declined -> not saved');
confirmAnswer = true; await submit($('memForm'));
ok((await mems()).some(m => /doctor/.test(m.text) && m.sensitive), 'form: sensitive confirmed -> saved + flagged');
$('memText').value = 'my password is 1234'; const before = (await mems()).length; await submit($('memForm'));
ok((await mems()).length === before && status().cls === 'error' && !status().hidden, 'form: credential refused with visible error');
$('statusClose').click(); ok($('statusBar').hidden, 'status banner dismissible');
// edit bypass attempt
const plain = [...doc.querySelectorAll('#memList .item')].find(d => /teal/.test(d.textContent));
[...plain.querySelectorAll('button')].find(b => b.textContent === 'Edit').click();
ok($('memId').value && $('memSave').textContent === 'Update memory', 'edit loads form');
$('memText').value = 'I take medication every day'; confirmAnswer = false; await submit($('memForm'));
ok(!(await mems()).some(m => /every day/.test(m.text)), 'edit to sensitive text without consent is blocked');
confirmAnswer = true; await submit($('memForm'));
ok((await mems()).some(m => /every day/.test(m.text) && m.sensitive), 'edit to sensitive text with consent succeeds and flags');
const edited = [...doc.querySelectorAll('#memList .item')].find(d => /every day/.test(d.textContent));
[...edited.querySelectorAll('button')].find(b => b.textContent === 'Edit').click();
$('memText').value = 'my api key is abc'; await submit($('memForm'));
ok(!(await mems()).some(m => /api key/.test(m.text)), 'edit to credential refused');
$('memCancel').click();
$('memSearch').value = 'doctor'; $('memSearch').dispatchEvent(new w.Event('input')); await sleep(150);
ok(doc.querySelectorAll('#memList .item').length === 1, 'search filters list');
$('memSearch').value = ''; $('memSearch').dispatchEvent(new w.Event('input')); await sleep(100);
$('memFilter').value = 'goal'; $('memFilter').dispatchEvent(new w.Event('change')); await sleep(100);
ok(doc.querySelectorAll('#memList .item').length === 0, 'category filter works'); $('memFilter').value = ''; $('memFilter').dispatchEvent(new w.Event('change')); await sleep(100);
const del = [...doc.querySelectorAll('#memList .item')].find(d => /teal/.test(d.textContent) || /every day/.test(d.textContent));
const nBefore = (await mems()).length;
[...del.querySelectorAll('button')].find(b => b.textContent === 'Delete').click(); await sleep(250);
ok((await mems()).length === nBefore - 1, 'delete removes memory (verified)');

console.log('6. projects');
await tab('projects');
$('projName').value = 'Overdrive'; await submit($('projForm'));
ok((await Proj.listProjects()).length === 1 && /Overdrive/.test($('projList').textContent), 'project created');
const slider = doc.querySelector('#projList input[type=range]'); slider.value = 40; slider.dispatchEvent(new w.Event('change')); await sleep(250);
ok((await Proj.listProjects())[0].progress === 40, 'progress slider saves');
let note = doc.querySelector('#projList input[placeholder^="Add a note"]'); note.value = 'added tournament mode';
note.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' })); await sleep(300);
ok((await Proj.listProjects())[0].notes.length === 1, 'note saved');
note = doc.querySelector('#projList input[placeholder^="Add a note"]'); note.value = 'doctor said rest'; confirmAnswer = false;
note.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter' })); await sleep(300);
ok((await Proj.listProjects())[0].notes.length === 1, 'sensitive note declined -> not saved');
await chat('project overdrive note: my password is abc'); await tab('chat'); await chat('project overdrive note: my password is abc');
ok(/decline/.test(lastMsg()) && (await Proj.listProjects())[0].notes.length === 1, 'chat: credential note refused');
await chat('project overdrive is 100%');
ok((await Proj.listProjects())[0].status === 'done', 'chat progress 100 -> done');
await chat('new project Therapy goals');
ok(/personal information/.test(lastMsg()), 'sensitive project name asks first');
await chat('no');

console.log('7. export');
await tab('settings'); confirmAnswer = true;
$('exportBtn').click(); await sleep(400);
let ex = await lastDownload(); let exj = JSON.parse(ex.text);
ok(exj.app === 'AUREN' && exj.omitted.memories >= 1, 'default export omits sensitive memories');
ok(!/medication|doctor/.test(ex.text), 'default export contains no sensitive text');
ok(!/messages|history/i.test(Object.keys(exj).join()), 'chat history never exported');
$('expSensitive').checked = true; confirmAnswer = false; const dn = downloads.length; $('exportBtn').click(); await sleep(300);
ok(downloads.length === dn, 'sensitive plain export needs explicit consent');
$('expPass').value = 'short'; $('exportBtn').click(); await sleep(300);
ok(status().cls === 'error' && downloads.length === dn, 'short passphrase rejected');
$('expPass').value = 'correct horse battery'; $('exportBtn').click(); await sleep(1500);
ex = await lastDownload(); exj = JSON.parse(ex.text);
ok(exj.encrypted === true && !/medication|doctor|Overdrive/.test(ex.text) && /encrypted/.test(ex.name), 'encrypted export has no plaintext');
const encrypted = ex.text;

console.log('8. import: wipe + restore');
$('wipeConfirm').value = 'delete'; $('wipeConfirm').dispatchEvent(new w.Event('input'));
ok($('wipeBtn').disabled, 'wipe disabled until DELETE typed exactly');
$('wipeConfirm').value = 'DELETE'; $('wipeConfirm').dispatchEvent(new w.Event('input'));
confirmAnswer = true; $('wipeBtn').click(); await sleep(500);
ok((await mems()).length === 0 && (await Proj.listProjects()).length === 0, 'wipe erases memories and projects');
ok((await dbMods.getAll('messages')).length <= 1, 'wipe erases chat history');
await importFile(encrypted, 'wrong passphrase');
ok(status().cls === 'error' && /decrypt/.test(status().text) && (await mems()).length === 0, 'wrong passphrase rejected, nothing written');
await importFile(encrypted, '');
ok(/passphrase/.test(status().text) && (await mems()).length === 0, 'missing passphrase rejected');
confirmAnswer = false; await importFile(encrypted, 'correct horse battery');
ok((await mems()).length === 0, 'declining the import summary writes nothing');
confirmAnswer = true; await importFile(encrypted, 'correct horse battery');
ok((await mems()).some(m => /medication|doctor/.test(m.text)) && (await Proj.listProjects()).some(p => p.name === 'Overdrive'), 'correct passphrase restores data');

console.log('9. import: hostile files');
const base = { app: 'AUREN', version: 1 };
const cnt = async () => (await mems()).length + (await Proj.listProjects()).length;
let c0 = await cnt();
await importFile('this is not json {'); ok(status().cls === 'error' && /not valid JSON/.test(status().text), 'garbage rejected');
await importFile({ app: 'Other', version: 1 }); ok(/not an AUREN/.test(status().text), 'wrong app rejected');
await importFile({ app: 'AUREN', version: 2 }); ok(/newer version/.test(status().text), 'future version rejected');
await importFile({ app: 'AUREN', version: 1, memories: 'oops' }); ok(/damaged/.test(status().text), 'non-list rejected');
await importFile({ ...base, memories: new Array(5001).fill({}) }); ok(/larger than AUREN accepts/.test(status().text), 'too many records rejected');
await importFile([1, 2, 3]); ok(status().cls === 'error', 'array root rejected');
{
  const input = $('importFile'); Object.defineProperty(input, 'files', { value: [{ size: 6 * 1024 * 1024, text: async () => '{}' }], configurable: true });
  input.dispatchEvent(new w.Event('change')); await sleep(200); ok(/too large/.test(status().text), 'oversized file rejected before reading');
}
ok((await cnt()) === c0, 'no rejected file changed the database');
const existing = (await mems())[0];
const newer = { ...existing, text: 'LOCAL VERSION WINS', updatedAt: '2099-01-01T00:00:00.000Z' };
await dbMods.put('memories', newer);
const hostile = `{"app":"AUREN","version":1,"__proto__":{"polluted":true},"memories":[
 {"id":"good-id-0001","text":"I like jazz","category":"interest","tags":["music"],"__proto__":{"polluted":true},"constructor":{"x":1}},
 {"id":"bad id!","text":"bad id"},
 {"id":"x","text":"short id"},
 {"id":"num-text-0001","text":12345},
 {"id":"pw-record-0001","text":"my password is swordfish"},
 {"id":"card-record-001","text":"card 4111 1111 1111 1111"},
 {"id":"sens-record-01","text":"I owe money to my bank","sensitive":false},
 {"id":"${existing.id}","text":"OLD IMPORTED VERSION","updatedAt":"2000-01-01T00:00:00.000Z"},
 {"id":"long-record-001","text":"${'x'.repeat(2001)}"},
 {"id":"tags-record-001","text":"tag test","tags":"notalist"},
 "just a string", null, 42,
 {"id":"good-id-0001","text":"duplicate id"},
 {"id":"datebad-00001","text":"date test","createdAt":"not a date","category":"hacker"}
],"projects":[{"id":"proj-hostile-1","name":"Ok project","progress":9999,"status":"weird","notes":[{"text":"fine note"},{"text":"password is abc"},{"text":5},"str"]},
 {"id":"proj-hostile-2","name":"api key project"}]}`;
await importFile(hostile);
ok(({}).polluted === undefined && Object.prototype.polluted === undefined, 'no prototype pollution');
const all = await mems(); const byId = Object.fromEntries(all.map(m => [m.id, m]));
ok(byId['good-id-0001'] && byId['good-id-0001'].text === 'I like jazz' && !('constructor' in byId['good-id-0001'] && typeof byId['good-id-0001'].constructor === 'object'), 'valid record imported, extra keys dropped');
ok(!all.some(m => /swordfish|4111|bad id|short id|12345|tag test|xxxx/.test(m.text)), 'invalid/blocked/oversized records skipped');
ok(byId['sens-record-01'] && byId['sens-record-01'].sensitive === true, 'sensitive text re-flagged despite sensitive:false in file');
ok(byId[existing.id].text === 'LOCAL VERSION WINS', 'older imported copy does not overwrite newer local one');
ok(byId['datebad-00001'] && byId['datebad-00001'].category === 'other' && !Number.isNaN(Date.parse(byId['datebad-00001'].createdAt)), 'bad date/category repaired');
const ps = await Proj.listProjects(); const hp = ps.find(p => p.id === 'proj-hostile-1');
ok(hp && hp.progress === 100 && hp.status === 'active' && hp.notes.length === 1 && hp.notes[0].text === 'fine note', 'project clamped; bad notes dropped');
ok(!ps.some(p => p.id === 'proj-hostile-2'), 'credential-named project skipped');
ok(/skipped/.test(confirms.at(-1)), 'import summary shown to user before writing');

console.log('10. storage failure display');
{
  const g = globalThis.indexedDB; delete globalThis.indexedDB; 
  const dbFresh = await import('../js/db.js?fresh'); let msg = '';
  try { await dbFresh.openDB(); } catch (e) { msg = e.message; }
  ok(/does not provide IndexedDB|blocking local storage/.test(msg), 'missing IndexedDB gives friendly error');
  globalThis.indexedDB = g;
  const q = dbMods.friendlyError(new w.DOMException('x', 'QuotaExceededError'));
  ok(/full/.test(q.message), 'quota error translated');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
