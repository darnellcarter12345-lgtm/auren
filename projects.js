// AUREN — js/projects.js
// Projects with status, progress (0-100) and a dated notes log.
// v0.2: names and notes go through the same sensitive-content gate as memories.

import { getAll, get, saveVerified, deleteVerified, uid, STORES } from './db.js';
import { gate } from './sensitive.js';

export const STATUSES = ['active', 'paused', 'done'];
export const MAX_NAME = 200, MAX_NOTE = 1000, MAX_NOTES = 200;
const now = () => new Date().toISOString();

export async function createProject(name, { confirmSensitive = false } = {}) {
  name = (name || '').trim();
  if (!name) throw new Error('A project needs a name.');
  if (name.length > MAX_NAME) throw new Error(`Project names are limited to ${MAX_NAME} characters.`);
  const sensitive = gate([name], confirmSensitive);
  const rec = { id: uid(), name, status: 'active', progress: 0, notes: [], sensitive, createdAt: now(), updatedAt: now() };
  return saveVerified(STORES.projects, rec);
}

// Only progress and status can be changed here (names and notes have their own gated paths).
export async function updateProject(id, changes) {
  const cur = await get(STORES.projects, id);
  if (!cur) throw new Error('That project no longer exists.');
  const next = { ...cur, updatedAt: now() };
  if (changes.progress !== undefined) next.progress = Math.max(0, Math.min(100, Math.round(Number(changes.progress) || 0)));
  if (changes.status !== undefined) next.status = STATUSES.includes(changes.status) ? changes.status : cur.status;
  return saveVerified(STORES.projects, next);
}

export async function addProjectNote(id, text, { confirmSensitive = false } = {}) {
  const cur = await get(STORES.projects, id);
  if (!cur) throw new Error('That project no longer exists.');
  text = (text || '').trim();
  if (!text) throw new Error('A note cannot be empty.');
  if (text.length > MAX_NOTE) throw new Error(`Notes are limited to ${MAX_NOTE} characters.`);
  if ((cur.notes || []).length >= MAX_NOTES) throw new Error(`This project already has ${MAX_NOTES} notes.`);
  const sensitive = gate([text], confirmSensitive);
  const next = { ...cur, notes: [...(cur.notes || []), { at: now(), text, sensitive }], updatedAt: now() };
  return saveVerified(STORES.projects, next);
}

export const deleteProject = id => deleteVerified(STORES.projects, id);
export const listProjects = async () =>
  (await getAll(STORES.projects)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export async function findProject(nameFragment) {
  const f = nameFragment.trim().toLowerCase();
  const all = await listProjects();
  return all.find(p => p.name.toLowerCase() === f) || all.find(p => p.name.toLowerCase().includes(f)) || null;
}
