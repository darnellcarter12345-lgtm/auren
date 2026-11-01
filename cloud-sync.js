// AUREN v2.9.1 — automatic sync without page reload loops.
// Synchronizes plans, reminders, projects and non-sensitive memories.
// Chat messages remain on this device.
import { getFirestore, doc, getDoc, runTransaction, onSnapshot, serverTimestamp, setDoc } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getAll, put, STORES } from './db.js';

const PLAN = 'auren_plans_v22';
const REMIND = 'auren_reminders_v24';
const OWNER = 'auren_cloud_device_owner_v1';
const KINDS = ['plans', 'reminders', 'projects', 'memories'];
const MAX_BYTES = 850000;
const valid = r => r && typeof r === 'object' && typeof r.id === 'string' && r.id.length < 150;
const isSensitive = r => r?.sensitive === true || r?.isSensitive === true || String(r?.category || '').toLowerCase() === 'sensitive';
const empty = () => ({ plans: [], reminders: [], projects: [], memories: [] });
const clean = d => Object.fromEntries(KINDS.map(k => [k, Array.isArray(d?.[k]) ? d[k].filter(valid) : []]));
const transferable = d => ({ ...clean(d), memories: clean(d).memories.filter(r => !isSensitive(r)) });
const jsonArray = key => { try { const a = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const map = arr => new Map(arr.map(r => [r.id, r]));
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const same = (a, b) => stable(a ?? null) === stable(b ?? null);
const signature = d => stable(KINDS.map(k => [...d[k]].sort((a, b) => a.id.localeCompare(b.id))));
const hasRecords = d => KINDS.some(k => d[k].length > 0);
const bytes = d => new TextEncoder().encode(JSON.stringify(d)).length;
async function readLocal() {
  return clean({ plans: jsonArray(PLAN), reminders: jsonArray(REMIND), projects: await getAll(STORES.projects), memories: await getAll(STORES.memories) });
}
async function applyIncoming(current, merged) {
  // Add/update only, never delete from the browser automatically.
  for (const p of merged.projects) if (!same(map(current.projects).get(p.id), p)) await put(STORES.projects, p);
  for (const m of merged.memories) if (!same(map(current.memories).get(m.id), m)) await put(STORES.memories, m);
  const plans = new Map([...map(current.plans), ...map(merged.plans)]);
  const reminders = new Map([...map(current.reminders), ...map(merged.reminders)]);
  if (!same(current.plans, [...plans.values()])) localStorage.setItem(PLAN, JSON.stringify([...plans.values()]));
  if (!same(current.reminders, [...reminders.values()])) localStorage.setItem(REMIND, JSON.stringify([...reminders.values()]));
  window.dispatchEvent(new CustomEvent('auren:cloud-synced'));
}
function reconcile(base, local, cloud) {
  const out = empty(), conflicts = [];
  for (const kind of KINDS) {
    const b = map(base[kind]), l = map(local[kind]), c = map(cloud[kind]);
    const merged = new Map(c);
    for (const id of new Set([...b.keys(), ...l.keys(), ...c.keys()])) {
      const old = b.get(id), mine = l.get(id), theirs = c.get(id);
      // Deletions are not propagated automatically in this version.
      if (!mine && old && !theirs) continue;
      if (!mine && old) continue;
      if (!theirs && old) { if (mine) merged.set(id, mine); continue; }
      if (!old) {
        if (mine && theirs && !same(mine, theirs)) conflicts.push(kind + ': ' + id);
        else if (mine) merged.set(id, mine);
        continue;
      }
      const changedLocal = mine && !same(old, mine);
      const changedCloud = theirs && !same(old, theirs);
      if (changedLocal && changedCloud && !same(mine, theirs)) conflicts.push(kind + ': ' + id);
      else if (changedLocal) merged.set(id, mine);
    }
    out[kind] = [...merged.values()];
  }
  return { data: out, conflicts };
}
function initialMerge(local, cloud) {
  const merged = empty(), conflicts = [];
  for (const kind of KINDS) {
    const records = map(cloud[kind]);
    for (const r of local[kind]) {
      if (records.has(r.id) && !same(records.get(r.id), r)) conflicts.push(kind + ': ' + r.id);
      else records.set(r.id, r);
    }
    merged[kind] = [...records.values()];
  }
  return { data: merged, conflicts };
}
export function mountCloudTransfer(app, user, accountCard) {
  if (!accountCard || accountCard.querySelector('[data-auren-sync]')) return;
  const firestore = getFirestore(app);
  // Shared nonsecret Worker URL: copy it between devices signed into one account.
  // Each account's document is protected by the per-UID Firestore security rules.
  const aiConfig = doc(firestore, 'users', user.uid, 'config', 'ai');
  const endpointKey = 'auren_ai_endpoint_v1';
  const validEndpoint = value => /^https:\/\/[a-z0-9.-]+\.workers\.dev$/i.test(String(value || ''));
  let knownEndpoint = '';
  let pushingEndpoint = false;
  const localEndpoint = () => localStorage.getItem(endpointKey) || '';
  const pushEndpoint = async () => {
    const value = localEndpoint();
    if (!validEndpoint(value) || pushingEndpoint || value === knownEndpoint) return;
    pushingEndpoint = true;
    try {
      await setDoc(aiConfig, {url:value, updatedAt:serverTimestamp()});
      knownEndpoint = value;
    } catch(err) { console.warn('AUREN endpoint config sync:',err); }
    finally { pushingEndpoint = false; }
  };
  // Read first: never overwrite a saved cloud URL with an empty browser setting.
  getDoc(aiConfig).then(snap => {
    const cloudUrl = String(snap.exists() ? snap.data()?.url || '' : '');
    if (validEndpoint(cloudUrl)) {
      knownEndpoint = cloudUrl;
      if (!validEndpoint(localEndpoint())) {
        localStorage.setItem(endpointKey, cloudUrl);
        window.dispatchEvent(new Event('auren:ai-endpoint-updated'));
      } else if (localEndpoint() !== cloudUrl) {
        // Preserve local endpoint; don't silently overwrite cloud config.
        console.warn('AUREN AI URLs differ between devices. Review Settings before changing.');
      }
    } else void pushEndpoint();
  }).catch(err => console.warn('AUREN AI config unavailable:',err));
  window.addEventListener('auren:ai-endpoint-changed', pushEndpoint);
  // Existing installations may have saved URL before this upgrade.
  setTimeout(() => { if (!knownEndpoint) void pushEndpoint(); }, 5000);

  const documentRef = doc(firestore, 'users', user.uid, 'sync', 'snapshot');
  const enabledKey = 'auren_sync_enabled_v29_' + user.uid;
  const baselineKey = 'auren_sync_baseline_v29_' + user.uid;
  const box = document.createElement('div'); box.dataset.aurenSync = 'true'; box.style.marginTop = '16px';
  const title = document.createElement('strong'); title.textContent = 'Your devices';
  const note = document.createElement('p'); note.className = 'hint'; note.textContent = 'Automatic sync for plans, reminders, projects and non-sensitive memories. Chat stays on this device.';
  const status = document.createElement('p'); status.className = 'hint'; status.setAttribute('role', 'status');
  const enable = document.createElement('button'); enable.type = 'button'; enable.textContent = 'Enable automatic sync';
  const pause = document.createElement('button'); pause.type = 'button'; pause.textContent = 'Pause automatic sync';
  const backup = document.createElement('button'); backup.type = 'button'; backup.textContent = 'Back up this device to cloud';
  const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = 'Bring cloud data onto this device';
  for (const b of [pause, backup, restore]) { b.className = 'ghost'; b.style.margin = '8px 8px 0 0'; }
  box.append(title, note, enable, pause, document.createElement('br'), backup, restore, status);
  accountCard.append(box);
  let enabled = localStorage.getItem(enabledKey) === 'yes';
  let busy = false, cloud = empty(), cloudReady = false, disposed = false, lastUploaded = '';
  const show = message => { status.textContent = message; };
  const buttons = () => { enable.hidden = enabled; pause.hidden = !enabled; };
  const setEnabled = value => { enabled = value; if (value) localStorage.setItem(enabledKey, 'yes'); else localStorage.removeItem(enabledKey); buttons(); };
  const readBase = () => { try { const d = JSON.parse(localStorage.getItem(baselineKey) || 'null'); return d?.version === 1 ? clean(d) : null; } catch { return null; } };
  const saveBase = d => localStorage.setItem(baselineKey, JSON.stringify({ version: 1, ...d }));
  buttons();
  if (localStorage.getItem(OWNER) && localStorage.getItem(OWNER) !== user.uid) {
    [enable, pause, backup, restore].forEach(b => b.disabled = true);
    show('Different account previously used on this browser. Use another browser profile to prevent mixing information.');
    return;
  }
  async function commit(base, local) {
    let finalData;
    await runTransaction(firestore, async tx => {
      const snap = await tx.get(documentRef);
      const latest = clean(snap.exists() ? snap.data() : empty());
      const result = base ? reconcile(base, local, latest) : initialMerge(local, latest);
      if (result.conflicts.length) throw new Error('Conflicting edits: ' + result.conflicts.slice(0, 3).join(', '));
      if (bytes({ version: 1, ...result.data }) > MAX_BYTES) throw new Error('Cloud document is too large. Use Export backup.');
      finalData = result.data;
      if (!same(signature(latest), signature(finalData))) tx.set(documentRef, { version: 1, ...finalData, updatedAt: serverTimestamp() });
    });
    return finalData;
  }
  async function sync() {
    if (!enabled || busy || !cloudReady || disposed || document.hidden) return;
    busy = true;
    try {
      const baseline = readBase();
      if (!baseline) { setEnabled(false); show('Sync paused: please enable it again on this device.'); return; }
      const localRaw = await readLocal(); const local = transferable(localRaw);
      const result = reconcile(baseline, local, cloud);
      if (result.conflicts.length) throw new Error('Conflicting edits: ' + result.conflicts.slice(0, 3).join(', '));
      if (same(signature(local), signature(result.data)) && same(signature(cloud), signature(result.data))) {
        show('Automatic sync is on. Everything is up to date.'); return;
      }
      const merged = same(signature(result.data), signature(cloud)) ? cloud : await commit(baseline, local);
      // Never reload: reloading after IndexedDB updates previously caused a loop.
      await applyIncoming(localRaw, merged);
      cloud = merged; saveBase(merged); localStorage.setItem(OWNER, user.uid);
      lastUploaded = signature(merged);
      show('Synced successfully. If a new item is not visible, refresh AUREN once manually.');
    } catch (err) {
      console.error('AUREN sync failed', err);
      if (/conflict|large|too big/i.test(err.message || '')) setEnabled(false);
      show('Sync issue: ' + (err.message || 'Connection unavailable. Your device data is kept.'));
    } finally { busy = false; }
  }
  enable.addEventListener('click', async () => {
    if (busy) return; busy = true;
    try {
      const localRaw = await readLocal(), local = transferable(localRaw);
      const snap = await getDoc(documentRef);
      const remote = clean(snap.exists() ? snap.data() : empty());
      if (!readBase() && hasRecords(local) && hasRecords(remote) && !confirm('This device and cloud both have information. Merge them by ID? Conflicting versions will not be overwritten.')) { show('Cancelled. Nothing changed.'); return; }
      localStorage.setItem('auren_pre_sync_backup_' + user.uid, JSON.stringify({ version: 1, ...localRaw }));
      const combined = await commit(readBase(), local);
      await applyIncoming(localRaw, combined);
      cloud = combined; cloudReady = true; saveBase(combined);
      localStorage.setItem(OWNER, user.uid); setEnabled(true);
      show('Automatic sync enabled. No page reload required.');
    } catch (err) { show('Could not enable sync: ' + (err.message || 'Try again.')); }
    finally { busy = false; }
  });
  pause.addEventListener('click', () => { setEnabled(false); show('Automatic sync paused. Nothing was deleted.'); });
  backup.addEventListener('click', async () => {
    if (busy || !confirm('Replace the cloud backup with this device’s saved information? Newer cloud edits could be lost.')) return;
    busy = true;
    try {
      const local = transferable(await readLocal());
      if (bytes({ version: 1, ...local }) > MAX_BYTES) throw new Error('Backup too large.');
      const snap = await getDoc(documentRef);
      if (snap.exists() && !confirm('Cloud data already exists. Really overwrite it?')) return;
      await runTransaction(firestore, async tx => { await tx.get(documentRef); tx.set(documentRef, { version: 1, ...local, updatedAt: serverTimestamp() }); });
      cloud = local; cloudReady = true; saveBase(local); localStorage.setItem(OWNER, user.uid);
      show('Cloud backup saved.');
    } catch (err) { show('Backup failed: ' + err.message); } finally { busy = false; }
  });
  restore.addEventListener('click', async () => {
    if (busy || !confirm('Import cloud records without deleting local records?')) return;
    busy = true;
    try {
      const snap = await getDoc(documentRef);
      if (!snap.exists()) { show('No cloud backup yet.'); return; }
      const localRaw = await readLocal(), local = transferable(localRaw);
      const incoming = clean(snap.data());
      const result = initialMerge(local, incoming);
      if (result.conflicts.length) throw new Error('Matching IDs contain different data. Import stopped to protect both copies.');
      localStorage.setItem('auren_pre_sync_backup_' + user.uid, JSON.stringify({ version: 1, ...localRaw }));
      await applyIncoming(localRaw, result.data); saveBase(result.data); cloud = incoming;
      localStorage.setItem(OWNER, user.uid);
      show('Imported. Refresh AUREN once manually to display the latest items.');
    } catch (err) { show('Import failed: ' + err.message); } finally { busy = false; }
  });
  const unsub = onSnapshot(documentRef, snap => {
    if (disposed) return;
    cloud = clean(snap.exists() ? snap.data() : empty()); cloudReady = true;
    if (enabled && !busy && !snap.metadata.hasPendingWrites) void sync();
  }, err => show('Cloud connection issue: ' + err.message));
  const interval = setInterval(() => { if (enabled && !busy) void sync(); }, 7000);
  window.addEventListener('pagehide', () => { disposed = true; clearInterval(interval); unsub(); }, { once: true });
  show(enabled ? 'Automatic sync is on. Checking your account…' : 'Automatic sync is paused. Enable it when ready.');
}
