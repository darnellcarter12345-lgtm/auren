// AUREN v2.8.9 — Explicit cloud transfer between signed-in devices.
// No automatic upload, no automatic overwrite, and no chat history transfer.
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { getAll, put, STORES } from './db.js';

const PLAN = 'auren_plans_v22';
const REMIND = 'auren_reminders_v24';
const OWNER = 'auren_cloud_device_owner_v1';
const MAX_BYTES = 850000; // Firestore single-document hard limit is 1 MiB.
const jsonParse = key => {
  try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
};
const validRecord = r => r && typeof r === 'object' && typeof r.id === 'string' && r.id.length < 150;
const uniqMerge = (local, cloud) => {
  const map = new Map();
  for (const record of cloud) if (validRecord(record)) map.set(record.id, record);
  for (const record of local) if (validRecord(record)) map.set(record.id, record);
  return [...map.values()];
};

export function mountCloudTransfer(firebaseApp, user, accountCard) {
  if (!accountCard) return;
  const db = getFirestore(firebaseApp);
  const reference = doc(db, 'users', user.uid, 'sync', 'snapshot');
  const previousOwner = localStorage.getItem(OWNER);
  const wrapper = document.createElement('div');
  wrapper.style.marginTop = '16px';
  const heading = document.createElement('strong');
  heading.textContent = 'Move your AUREN data between devices';
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent = 'Cloud transfer is manual for now. It copies your planner, reminders, projects, and memories, but not chat history. It does not yet keep devices automatically updated.';
  const status = document.createElement('p');
  status.className = 'hint';
  status.setAttribute('role', 'status');
  status.textContent = 'Choose an action below.';
  const save = document.createElement('button');
  save.type = 'button'; save.textContent = 'Back up this device to cloud';
  const restore = document.createElement('button');
  restore.type = 'button'; restore.textContent = 'Bring cloud data onto this device';
  restore.className = 'ghost'; restore.style.marginLeft = '8px'; restore.style.marginTop = '8px';
  wrapper.append(heading, note, save, restore, status);
  accountCard.append(wrapper);
  if (previousOwner && previousOwner !== user.uid) {
    save.disabled = true; restore.disabled = true;
    status.textContent = 'This browser was linked to a different AUREN account. To prevent mixing private data, use a separate browser profile or device. No data has been erased.';
    return;
  }
  const busy = async (task) => {
    save.disabled = restore.disabled = true;
    status.textContent = 'Working securely…';
    try { await task(); }
    catch (e) { console.error('AUREN cloud transfer failed', e); status.textContent = 'Transfer failed: ' + (e?.message || 'Please retry. Local data was not intentionally deleted.'); }
    finally { save.disabled = restore.disabled = false; }
  };
  save.addEventListener('click', () => busy(async () => {
    const existing = await getDoc(reference);
    if (existing.exists() && !confirm('Replace your existing cloud backup with the information on this device? This could replace newer cloud information.')) {
      status.textContent = 'Cancelled. Cloud data unchanged.'; return;
    }
    const data = {
      version: 1,
      plans: jsonParse(PLAN).filter(validRecord).slice(0, 500),
      reminders: jsonParse(REMIND).filter(validRecord).slice(0, 500),
      projects: (await getAll(STORES.projects)).filter(validRecord),
      memories: (await getAll(STORES.memories)).filter(validRecord)
    };
    const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
    if (bytes > MAX_BYTES) throw new Error('There is too much data for one transfer. Please export a local backup first.');
    if (!confirm(`Send this device’s ${data.plans.length} plans, ${data.reminders.length} reminders, ${data.projects.length} projects and ${data.memories.length} memories to your private AUREN account?`)) {
      status.textContent = 'Cancelled. Nothing uploaded.'; return;
    }
    await setDoc(reference, { ...data, updatedAt: serverTimestamp() });
    localStorage.setItem(OWNER, user.uid);
    status.textContent = 'Cloud backup saved. Sign in on another device and choose Bring cloud data onto this device.';
  }));
  restore.addEventListener('click', () => busy(async () => {
    const snapshot = await getDoc(reference);
    if (!snapshot.exists()) { status.textContent = 'No cloud backup yet. Back up your first device before transferring.'; return; }
    const data = snapshot.data();
    if (data.version !== 1 || !['plans','reminders','projects','memories'].every(k => Array.isArray(data[k]))) throw new Error('Unexpected cloud backup format. Nothing imported.');
    const localPlans = jsonParse(PLAN), localReminders = jsonParse(REMIND);
    const localProjects = await getAll(STORES.projects), localMemories = await getAll(STORES.memories);
    const merged = {
      plans: uniqMerge(localPlans, data.plans),
      reminders: uniqMerge(localReminders, data.reminders),
      projects: uniqMerge(localProjects, data.projects),
      memories: uniqMerge(localMemories, data.memories)
    };
    // Never silently merge an unrelated account's existing data.
    const hasLocal = localPlans.length || localReminders.length || localProjects.length || localMemories.length;
    if (hasLocal && !localStorage.getItem(OWNER)) {
      if (!confirm('This device already has saved AUREN information. Combine it with this account’s cloud backup? Only do this if both belong to you.')) {
        status.textContent = 'Cancelled. Local data unchanged.'; return;
      }
    } else if (!confirm('Bring your cloud data onto this device? Existing records with the same ID will be kept from this device.')) {
      status.textContent = 'Cancelled. Local data unchanged.'; return;
    }
    // Save merged records; no clears or deletions. Reload so AUREN re-reads planner arrays.
    for (const record of merged.projects) await put(STORES.projects, record);
    for (const record of merged.memories) await put(STORES.memories, record);
    localStorage.setItem(PLAN, JSON.stringify(merged.plans));
    localStorage.setItem(REMIND, JSON.stringify(merged.reminders));
    localStorage.setItem(OWNER, user.uid);
    status.textContent = 'Data transferred. Refreshing AUREN…';
    location.reload();
  }));
}
