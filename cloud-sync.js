
 // AUREN v2.9.0 - cautious automatic synchronization for signed-in devices.
 // Existing manual backup remains. No chat history or automatic sensitive-memory uploads.
 import { getFirestore, doc, getDoc, setDoc, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
 import { getAll, put, del, STORES } from './db.js';

 const PLAN = 'auren_plans_v22';
 const REMIND = 'auren_reminders_v24';
 const OWNER = 'auren_cloud_device_owner_v1';
 const KINDS = ['plans', 'reminders', 'projects', 'memories'];
 const LIMIT = 850000;
 const valid = r => r && typeof r === 'object' && typeof r.id === 'string' && r.id.length < 150;
 const clone = value => JSON.parse(JSON.stringify(value));
 const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
 const mapOf = values => new Map((Array.isArray(values) ? values : []).filter(valid).map(v => [v.id, v]));
 const readJSON = key => { try { const r = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(r) ? r : []; } catch { return []; } };
 const safeData = data => Object.fromEntries(KINDS.map(k => [k, (Array.isArray(data?.[k]) ? data[k] : []).filter(valid)]));
 const emptyData = () => Object.fromEntries(KINDS.map(k => [k, []]));
 const isSensitive = r => r?.sensitive === true || r?.isSensitive === true || String(r?.category || '').toLowerCase() === 'sensitive';
 const transferable = data => ({ ...data, memories: data.memories.filter(r => !isSensitive(r)) });
 const bytes = value => new TextEncoder().encode(JSON.stringify(value)).length;
 const baselineKey = uid => `auren_sync_baseline_v29_${uid}`;
 const enabledKey = uid => `auren_sync_enabled_v29_${uid}`;

 async function readLocal() {
   return safeData({ plans: readJSON(PLAN), reminders: readJSON(REMIND),
     projects: await getAll(STORES.projects), memories: await getAll(STORES.memories) });
 }
 async function applyLocal(data) {
   const existing = await readLocal();
   // Preserve sensitive records that never leave this device.
   const special = existing.memories.filter(isSensitive);
   for (const p of data.projects) await put(STORES.projects, p);
   for (const m of data.memories) await put(STORES.memories, m);
   // Apply deletions only after a conflict-checked sync. Preserve local sensitive memories.
   for (const p of existing.projects) if (!data.projects.some(r => r.id === p.id)) await del(STORES.projects, p.id);
   for (const m of existing.memories) if (!isSensitive(m) && !data.memories.some(r => r.id === m.id)) await del(STORES.memories, m.id);
   localStorage.setItem(PLAN, JSON.stringify(data.plans));
   localStorage.setItem(REMIND, JSON.stringify(data.reminders));
   for (const m of special) await put(STORES.memories, m);
 }
 function mergeDiff(baseData, localData, remoteData) {
   const result = emptyData(), conflicts = [];
   for (const kind of KINDS) {
     const base = mapOf(baseData[kind]);
     const local = mapOf(localData[kind]);
     const remote = mapOf(remoteData[kind]);
     const resultMap = new Map(remote);
     for (const id of new Set([...base.keys(), ...local.keys(), ...remote.keys()])) {
       const b = base.get(id), l = local.get(id), r = remote.get(id);
       const localChanged = !equal(b, l), remoteChanged = !equal(b, r);
       if (localChanged && remoteChanged && !equal(l, r)) { conflicts.push(`${kind}: ${id}`); continue; }
       if (localChanged) { if (l) resultMap.set(id, l); else resultMap.delete(id); }
     }
     result[kind] = [...resultMap.values()];
   }
   return { data: result, conflicts };
 }
 function mergeByID(local, remote) {
   const combined = emptyData();
   for (const kind of KINDS) {
     const m = mapOf(remote[kind]);
     for (const [id, rec] of mapOf(local[kind])) if (!m.has(id)) m.set(id, rec);
     combined[kind] = [...m.values()];
   }
   return combined;
 }

 export function mountCloudTransfer(firebaseApp, user, accountCard) {
   if (!accountCard || accountCard.querySelector('[data-auren-sync]')) return;
   const db = getFirestore(firebaseApp);
   const ref = doc(db, 'users', user.uid, 'sync', 'snapshot');
   const owner = localStorage.getItem(OWNER);
   const wrapper = document.createElement('div');
   wrapper.dataset.aurenSync = 'true';
   wrapper.style.marginTop = '16px';
   const heading = document.createElement('strong'); heading.textContent = 'Your devices';
   const description = document.createElement('p'); description.className = 'hint';
   description.textContent = 'Sync plans, reminders, projects and non-sensitive memories with this account. Chat history stays on this device.';
   const status = document.createElement('p'); status.className = 'hint'; status.setAttribute('role', 'status');
   const start = document.createElement('button'); start.type = 'button'; start.textContent = 'Enable automatic sync';
   const backup = document.createElement('button'); backup.type = 'button'; backup.textContent = 'Back up this device to cloud';
   const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = 'Bring cloud data onto this device';
   const stop = document.createElement('button'); stop.type = 'button'; stop.textContent = 'Pause automatic sync';
   for (const b of [backup, restore, stop]) { b.className = 'ghost'; b.style.margin = '8px 8px 0 0'; }
   wrapper.append(heading, description, start, stop, document.createElement('br'), backup, restore, status);
   accountCard.append(wrapper);
   const report = message => { status.textContent = message; };
   let enabled = localStorage.getItem(enabledKey(user.uid)) === 'yes';
   let busy = false, ready = false, seenCloud = false, remote = emptyData(), lastSignature = '', lastCheck = 0;
   let stopped = false, timer, unsubscribe = () => {};
   const updateButtons = () => { start.hidden = enabled; stop.hidden = !enabled; };
   updateButtons();
   if (owner && owner !== user.uid) {
     for (const b of [start, stop, backup, restore]) b.disabled = true;
     report('This browser previously held a different AUREN account. Use a separate browser profile to avoid mixing private data. Nothing has been erased.');
     return;
   }
   function loadBaseline() { try { const v = JSON.parse(localStorage.getItem(baselineKey(user.uid))); return v && v.version === 1 ? safeData(v) : null; } catch { return null; } }
   function saveBaseline(data) { localStorage.setItem(baselineKey(user.uid), JSON.stringify({ version: 1, ...data })); }
   async function syncOnce() {
     if (!enabled || !ready || !seenCloud || busy || stopped || document.hidden) return;
     busy = true;
     try {
       const local = transferable(await readLocal());
       const base = loadBaseline();
       if (!base) { report('Sync is paused. Use Enable automatic sync to approve linking this device.'); enabled = false; updateButtons(); return; }
       const initial = mergeDiff(base, local, remote);
       if (initial.conflicts.length) { enabled = false; localStorage.removeItem(enabledKey(user.uid)); updateButtons(); report('Sync paused: conflicting edits on two devices. Both local and cloud copies are preserved. Use a manual backup before resolving.'); return; }
       if (!equal(initial.data, remote)) {
         const desired = initial.data;
         if (bytes({ version: 1, ...desired }) > LIMIT) throw new Error('Cloud data exceeds document size limit. Sync paused; export a local backup.');
         await runTransaction(db, async tx => {
           const snapshot = await tx.get(ref);
           const latest = safeData(snapshot.exists() ? snapshot.data() : emptyData());
           const merged = mergeDiff(base, local, latest);
           if (merged.conflicts.length) throw new Error('Concurrent changes detected. No changes uploaded; both copies are preserved.');
           if (bytes({ version: 1, ...merged.data }) > LIMIT) throw new Error('Cloud backup exceeds safe size.');
           tx.set(ref, { version: 1, ...merged.data, updatedAt: serverTimestamp() });
           remote = merged.data;
         });
       }
       const combined = mergeDiff(base, local, remote);
       if (combined.conflicts.length) throw new Error('Conflicting changes detected. Sync has been paused.');
       const latestLocal = transferable(await readLocal());
       if (!equal(latestLocal, combined.data)) {
         await applyLocal(combined.data);
         saveBaseline(combined.data);
         localStorage.setItem(OWNER, user.uid);
         report('Synced. Refreshing AUREN to show the newest plans.');
         location.reload();
         return;
       }
       saveBaseline(combined.data);
       localStorage.setItem(OWNER, user.uid);
       lastSignature = JSON.stringify(combined.data);
       report('Automatic sync is on. Your devices are up to date.');
     } catch (error) {
       console.error('AUREN auto sync:', error);
       if (/conflict|concurrent|size|limit/i.test(error?.message || '')) {
         enabled = false; localStorage.removeItem(enabledKey(user.uid)); updateButtons();
       }
       report('Sync issue: ' + (error?.message || 'Connection unavailable. Changes remain on this device.'));
     } finally { busy = false; }
   }
   async function initialize() {
     if (busy) return;
     busy = true;
     try {
       const local = transferable(await readLocal());
       const snap = await getDoc(ref);
       const cloud = safeData(snap.exists() ? snap.data() : emptyData());
       const baseline = loadBaseline();
       if (!baseline && Object.values(local).some(v => v.length) && Object.values(cloud).some(v => v.length)) {
         if (!confirm('This device and your cloud account both contain AUREN information. Combine records by ID? Matching IDs will use the cloud version. Your device information will be kept in a local backup first.')) {
           report('Sync not enabled. Existing information unchanged.'); return;
         }
       }
       const combined = baseline ? mergeDiff(baseline, local, cloud) : {data: mergeByID(local, cloud), conflicts: []};
       if (combined.conflicts.length) throw new Error('Different edits found. Use manual backup before enabling automatic sync.');
       const exportLocal = { ...local, version: 1 };
       // One-time local rollback of pre-sync state; never automatically delete it.
       localStorage.setItem(`auren_pre_sync_backup_${user.uid}`, JSON.stringify(exportLocal));
       if (bytes({version:1,...combined.data}) > LIMIT) throw new Error('Too much data for cloud document. Export your local backup first.');
       await runTransaction(db, async tx => {
         const current = await tx.get(ref);
         const latest = safeData(current.exists() ? current.data() : emptyData());
         const revised = baseline ? mergeDiff(baseline, local, latest) : { data: mergeByID(local, latest), conflicts: [] };
         if (revised.conflicts.length) throw new Error('Another device changed the same record. Nothing overwritten.');
         if (bytes({version:1,...revised.data}) > LIMIT) throw new Error('Cloud document size limit reached.');
         tx.set(ref, {version:1,...revised.data,updatedAt:serverTimestamp()});
         remote = revised.data;
       });
       await applyLocal(remote);
       localStorage.setItem(OWNER, user.uid);
       saveBaseline(remote);
       enabled = true; localStorage.setItem(enabledKey(user.uid), 'yes'); updateButtons();
       report('Automatic sync enabled. Opening your updated AUREN…');
       location.reload();
     } catch (e) { report('Could not enable sync: ' + (e?.message || 'Please retry.')); }
     finally { busy = false; }
   }
   start.addEventListener('click', initialize);
   stop.addEventListener('click', () => { enabled = false; localStorage.removeItem(enabledKey(user.uid)); updateButtons(); report('Automatic sync paused. Data on this device is kept.'); });
   backup.addEventListener('click', async () => {
     if (busy) return;
     if (!confirm('Replace your cloud backup with this device’s records? This can overwrite newer cloud edits. Use only if necessary.')) return;
     busy = true;
     try {
       const data = transferable(await readLocal());
       if (bytes({version:1,...data}) > LIMIT) throw new Error('Too much data for this backup.');
       await setDoc(ref, {version:1,...data,updatedAt:serverTimestamp()});
       remote = data; saveBaseline(data); localStorage.setItem(OWNER,user.uid);
       report('Cloud backup saved.');
     } catch (e) { report('Backup failed: ' + (e?.message || 'Please try again.')); }
     finally { busy = false; }
   });
   restore.addEventListener('click', async () => {
     if (busy) return;
     if (!confirm('Bring cloud data onto this device? Records not present in cloud will be kept. Changes made locally might need a separate backup.')) return;
     busy = true;
     try {
       const snap = await getDoc(ref);
       if (!snap.exists()) { report('No cloud backup available yet.'); return; }
       const cloud = safeData(snap.data());
       const local = transferable(await readLocal());
       const combined = mergeByID(local, cloud);
       localStorage.setItem(`auren_pre_sync_backup_${user.uid}`, JSON.stringify({version:1,...local}));
       await applyLocal(combined); saveBaseline(cloud); localStorage.setItem(OWNER,user.uid);
       report('Cloud data imported. Refreshing…'); location.reload();
     } catch (e) { report('Restore failed: ' + (e?.message || 'Please retry.')); }
     finally { busy = false; }
   });
   unsubscribe = onSnapshot(ref, snap => {
     if (stopped) return;
     remote = safeData(snap.exists() ? snap.data() : emptyData());
     seenCloud = true;
     if (!snap.metadata.hasPendingWrites && enabled && ready) void syncOnce();
   }, error => { report('Cloud connection issue: ' + error.message); });
   const check = async () => {
     if (stopped || !enabled || !ready || busy || document.hidden) return;
     const now = Date.now(); if (now - lastCheck < 3500) return; lastCheck = now;
     try {
       const local = transferable(await readLocal());
       if (!equal(JSON.stringify(local), lastSignature) || seenCloud) await syncOnce();
     } catch (e) { report('Local sync check failed: ' + e.message); }
   };
   timer = setInterval(check, 4500);
   window.addEventListener('pagehide', () => { stopped = true; clearInterval(timer); unsubscribe(); }, {once:true});
   ready = true;
   if (enabled) report('Automatic sync is on. Checking your saved information…');
   else report('Your current manual cloud transfer still works. Turn on automatic sync when ready.');
   if (enabled && seenCloud) void syncOnce();
 }
