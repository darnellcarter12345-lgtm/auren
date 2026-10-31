// AUREN — js/backup.js
// Export (optionally encrypted) and DEFENSIVE import of backup files.
// An imported file is treated as untrusted input: every field is checked, rebuilt from a
// whitelist, size-limited, and run through the sensitive-content gate before anything is written.

import { classify } from './sensitive.js';
import { CATEGORIES, MAX_TEXT, MAX_TAGS, MAX_TAG_LEN } from './memory.js';
import { STATUSES, MAX_NAME, MAX_NOTE, MAX_NOTES } from './projects.js';
import { saveVerified, STORES } from './db.js';

export const LIMITS = { fileBytes: 5 * 1024 * 1024, memories: 5000, projects: 500 };
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ITERATIONS = 210000;

// ---------- export ----------
export function buildBackup({ memories, projects }, { includeSensitive = false } = {}) {
  const mems = memories.filter(m => includeSensitive || !m.sensitive);
  const projs = projects
    .filter(p => includeSensitive || !p.sensitive)
    .map(p => ({ ...p, notes: (p.notes || []).filter(n => includeSensitive || !n.sensitive) }));
  return {
    app: 'AUREN', version: 1, exportedAt: new Date().toISOString(), includesSensitive: !!includeSensitive,
    memories: mems, projects: projs,
    omitted: { memories: memories.length - mems.length, projects: projects.length - projs.length },
  };
}

// ---------- encryption (WebCrypto; PBKDF2 + AES-GCM) ----------
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

function needSubtle() {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('Encryption needs a secure page (https or localhost). It is unavailable here.');
  }
  return globalThis.crypto.subtle;
}
async function deriveKey(pass, salt, iterations) {
  const subtle = needSubtle();
  const base = await subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptBackup(obj, pass) {
  if (!pass || pass.length < 8) throw new Error('Choose a passphrase of at least 8 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return { app: 'AUREN', encrypted: true, version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(ct) };
}
export async function decryptBackup(env, pass) {
  if (!pass) throw new Error('This backup is encrypted. Enter its passphrase first.');
  const it = env.iterations;
  if (!Number.isInteger(it) || it < 100000 || it > 1000000) throw new Error('This encrypted backup has unsupported settings.');
  try {
    const key = await deriveKey(pass, unb64(env.salt), it);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (e) {
    if (String(e.message).includes('secure page')) throw e;
    throw new Error('Could not decrypt: wrong passphrase, or the file is damaged.');
  }
}

// ---------- defensive import ----------
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const isoOr = (v, fallback) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isNaN(t) ? fallback : new Date(t).toISOString(); };

function cleanMemory(r, nowIso) {
  if (!isObj(r)) return { skip: 'not an object' };
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return { skip: 'invalid id' };
  if (typeof r.text !== 'string' || !r.text.trim()) return { skip: 'missing text' };
  const text = r.text.trim();
  if (text.length > MAX_TEXT) return { skip: 'text too long' };
  let tags = [];
  if (r.tags !== undefined) {
    if (!Array.isArray(r.tags)) return { skip: 'invalid tags' };
    tags = r.tags.filter(t => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(t => t && t.length <= MAX_TAG_LEN).slice(0, MAX_TAGS);
  }
  const c1 = classify(text), c2 = classify(tags.join(' '));
  if (c1.blocked.length || c2.blocked.length) return { skip: 'contains credential-like data' };
  const flagged = c1.sensitive.length > 0 || c2.sensitive.length > 0;
  const created = isoOr(r.createdAt, nowIso);
  return { rec: {
    id: r.id, text, category: CATEGORIES.includes(r.category) ? r.category : 'other', tags,
    sensitive: flagged || r.sensitive === true, createdAt: created, updatedAt: isoOr(r.updatedAt, created), lastRecalledAt: null,
  }, flagged };
}

function cleanProject(r, nowIso) {
  if (!isObj(r)) return { skip: 'not an object' };
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return { skip: 'invalid id' };
  if (typeof r.name !== 'string' || !r.name.trim()) return { skip: 'missing name' };
  const name = r.name.trim();
  if (name.length > MAX_NAME) return { skip: 'name too long' };
  const cn = classify(name);
  if (cn.blocked.length) return { skip: 'contains credential-like data' };
  let flagged = cn.sensitive.length > 0, droppedNotes = 0;
  const notes = [];
  for (const n of (Array.isArray(r.notes) ? r.notes : []).slice(0, MAX_NOTES)) {
    if (!isObj(n) || typeof n.text !== 'string' || !n.text.trim() || n.text.length > MAX_NOTE) { droppedNotes++; continue; }
    const cl = classify(n.text);
    if (cl.blocked.length) { droppedNotes++; continue; }
    if (cl.sensitive.length) flagged = true;
    notes.push({ at: isoOr(n.at, nowIso), text: n.text.trim(), sensitive: cl.sensitive.length > 0 || n.sensitive === true });
  }
  const prog = Math.max(0, Math.min(100, Math.round(Number(r.progress) || 0)));
  const created = isoOr(r.createdAt, nowIso);
  return { rec: {
    id: r.id, name, status: STATUSES.includes(r.status) ? r.status : 'active', progress: prog, notes,
    sensitive: cn.sensitive.length > 0 || r.sensitive === true, createdAt: created, updatedAt: isoOr(r.updatedAt, created),
  }, flagged, droppedNotes };
}

// existing = { memories: Map(id->record), projects: Map(id->record) }
// Returns { plan, report } or throws an Error with a plain-English reason. Writes NOTHING.
export function validateBackup(data, existing) {
  if (!isObj(data)) throw new Error('This is not an AUREN backup (unexpected structure).');
  if (data.app !== 'AUREN') throw new Error('This is not an AUREN backup file.');
  if (data.encrypted) throw new Error('This backup is encrypted and must be decrypted first.');
  if (!Number.isInteger(data.version) || data.version < 1) throw new Error('This backup has no valid version number.');
  if (data.version > 1) throw new Error('This backup was made by a newer version of AUREN. Update AUREN first.');
  const mems = data.memories === undefined ? [] : data.memories;
  const projs = data.projects === undefined ? [] : data.projects;
  if (!Array.isArray(mems) || !Array.isArray(projs)) throw new Error('This backup is damaged (memories/projects are not lists).');
  if (mems.length > LIMITS.memories || projs.length > LIMITS.projects)
    throw new Error(`This backup is larger than AUREN accepts (${LIMITS.memories} memories / ${LIMITS.projects} projects).`);

  const nowIso = new Date().toISOString();
  const plan = { memories: [], projects: [] };
  const report = { add: 0, update: 0, keptLocal: 0, flagged: 0, droppedNotes: 0, skipped: {}, seen: mems.length + projs.length };
  const skip = why => { report.skipped[why] = (report.skipped[why] || 0) + 1; };
  const seenIds = new Set();

  const consider = (kind, raw, cleaner, existingMap) => {
    const out = cleaner(raw, nowIso);
    if (out.skip) return skip(out.skip);
    const key = kind + ':' + out.rec.id;
    if (seenIds.has(key)) return skip('duplicate id in file');
    seenIds.add(key);
    if (out.flagged) report.flagged++;
    if (out.droppedNotes) report.droppedNotes += out.droppedNotes;
    const cur = existingMap.get(out.rec.id);
    if (!cur) { report.add++; plan[kind].push(out.rec); }
    else if (out.rec.updatedAt > cur.updatedAt) { report.update++; plan[kind].push(out.rec); }
    else report.keptLocal++;
  };
  mems.forEach(r => consider('memories', r, cleanMemory, existing.memories));
  projs.forEach(r => consider('projects', r, cleanProject, existing.projects));
  return { plan, report };
}

export async function applyPlan(plan) {
  for (const m of plan.memories) await saveVerified(STORES.memories, m);
  for (const p of plan.projects) await saveVerified(STORES.projects, p);
}

export function describeReport(r) {
  const skipped = Object.entries(r.skipped).map(([why, n]) => `${n} skipped (${why})`);
  return [`${r.add} new, ${r.update} newer than your copy, ${r.keptLocal} unchanged (your newer local version kept).`,
    r.flagged ? `${r.flagged} look sensitive and will be marked sensitive.` : '',
    r.droppedNotes ? `${r.droppedNotes} invalid project notes dropped.` : '', ...skipped].filter(Boolean).join('\n');
}
