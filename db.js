// AUREN — js/db.js
// Thin wrapper around IndexedDB (the browser's built-in database).
// Data lives on YOUR device and survives closing/reopening the app.
// v0.2: friendlier storage errors, recovery from closed connections, health check, id fallback.

const DB_NAME = 'auren';
const DB_VERSION = 1;
export const STORES = { memories: 'memories', projects: 'projects', messages: 'messages' };

let dbPromise = null;

// Unique ids. crypto.randomUUID only exists on secure pages (https / localhost),
// so fall back for plain-http testing on a phone over your Wi-Fi.
export function uid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}

// Turn low-level browser errors into messages a person can act on.
export function friendlyError(e) {
  const name = (e && e.name) || '';
  let msg;
  if (name === 'QuotaExceededError') msg = 'Storage is full on this device. Export a backup, free some space, then try again. Nothing new was saved.';
  else if (name === 'InvalidStateError') msg = 'The browser closed AUREN\'s database. Reload the page and try again.';
  else if (name === 'SecurityError' || name === 'NotAllowedError') msg = 'The browser is blocking local storage (private/incognito mode or strict privacy settings can do this).';
  else if (name === 'VersionError') msg = 'This browser holds a newer AUREN database than this version understands. Use the newest AUREN files.';
  else msg = (e && e.message) ? e.message : 'Unknown storage problem.';
  const err = new Error(msg);
  err.name = 'StorageError';
  err.cause = e;
  return err;
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(friendlyError({ name: 'SecurityError', message: 'This browser does not provide IndexedDB storage.' }));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of Object.values(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };  // another tab upgraded
      db.onclose = () => { dbPromise = null; };                        // browser closed it unexpectedly
      resolve(db);
    };
    req.onblocked = () => reject(friendlyError({ message: 'AUREN is open in another tab that is blocking an update. Close other AUREN tabs and reload.' }));
    req.onerror = () => reject(friendlyError(req.error));
  }).catch(e => { dbPromise = null; throw (e.name === 'StorageError' ? e : friendlyError(e)); });
  return dbPromise;
}

// Resolves only when the transaction has fully COMMITTED (not just queued).
function tx(store, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    let t;
    try { t = db.transaction(store, mode); } catch (e) { dbPromise = null; return reject(friendlyError(e)); }
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(friendlyError(t.error));
    t.onabort = () => reject(friendlyError(t.error || { name: 'QuotaExceededError' }));
  }));
}

export const put = (store, value) => tx(store, 'readwrite', s => s.put(value));
export const get = (store, id) => tx(store, 'readonly', s => s.get(id));
export const getAll = store => tx(store, 'readonly', s => s.getAll());
export const del = (store, id) => tx(store, 'readwrite', s => s.delete(id));
export const clear = store => tx(store, 'readwrite', s => s.clear());

// Save, then read it back and compare. Throws if the record is not really there.
// This is how AUREN keeps its rule: never claim something was saved unless it was.
export async function saveVerified(store, record) {
  await put(store, record);
  const back = await get(store, record.id);
  if (!back || JSON.stringify(back) !== JSON.stringify(record)) {
    throw new Error('Save could not be verified in the database.');
  }
  return back;
}

export async function deleteVerified(store, id) {
  await del(store, id);
  const back = await get(store, id);
  if (back) throw new Error('Delete could not be verified in the database.');
  return true;
}

// Startup check: can we really write, read back and delete a record?
export async function healthCheck() {
  const id = '__probe__';
  await put(STORES.messages, { id, role: 'probe', text: '', at: new Date().toISOString() });
  const back = await get(STORES.messages, id);
  await del(STORES.messages, id);
  if (!back) throw new Error('Storage accepted a write but could not read it back.');
  return true;
}

export async function storageEstimate() {
  try {
    const s = globalThis.navigator && globalThis.navigator.storage;
    if (s && s.estimate) return await s.estimate();
  } catch { /* ignore */ }
  return null;
}
