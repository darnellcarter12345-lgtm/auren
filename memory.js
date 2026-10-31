// AUREN — js/memory.js
// Long-term memory: create, search (retrieval), edit, delete. All saves are verified AND gated.
// v0.2: the sensitive-content gate lives HERE, so no caller (chat, form, import) can bypass it.

import { getAll, get, saveVerified, deleteVerified, uid, STORES } from './db.js';
import { gate } from './sensitive.js';

export const CATEGORIES = ['preference', 'interest', 'goal', 'project', 'person', 'routine', 'fact', 'other'];
export const MAX_TEXT = 2000, MAX_TAGS = 20, MAX_TAG_LEN = 40;

const now = () => new Date().toISOString();

const STOP = new Set(('a an and are as at be but by do does for from had has have how i if in into is it its me my of on or our so ' +
  'that the their them then there these they this to was we were what when where which who why will with you your about know remember ' +
  'tell recall sir please can could would should').split(' '));

function stem(w) {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}

export function tokenize(s) {
  return (String(s).toLowerCase().match(/[a-z0-9']+/g) || [])
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(stem);
}

export function guessCategory(text) {
  const t = text.toLowerCase();
  if (/\b(want to|goal|plan to|aim to|hope to)\b/.test(t)) return 'goal';
  if (/\b(prefer|favorite|favourite|love|like|hate|dislike)\b/.test(t)) return 'preference';
  if (/\b(hobby|hobbies|enjoy|into|interested)\b/.test(t)) return 'interest';
  if (/\b(every (day|morning|night|week)|daily|weekly|routine)\b/.test(t)) return 'routine';
  return 'fact';
}

function cleanTags(tags) {
  const out = (tags || []).map(t => String(t).trim().toLowerCase()).filter(Boolean);
  if (out.length > MAX_TAGS) throw new Error(`Too many tags (maximum ${MAX_TAGS}).`);
  if (out.some(t => t.length > MAX_TAG_LEN)) throw new Error(`A tag is too long (maximum ${MAX_TAG_LEN} characters).`);
  return out;
}

export async function createMemory({ text, category = 'fact', tags = [], confirmSensitive = false }) {
  text = (text || '').trim();
  if (!text) throw new Error('Cannot save an empty memory.');
  if (text.length > MAX_TEXT) throw new Error(`That memory is too long (maximum ${MAX_TEXT} characters).`);
  tags = cleanTags(tags);
  if (!CATEGORIES.includes(category)) category = 'other';
  const sensitive = gate([text, tags.join(' ')], confirmSensitive);   // throws if blocked / unconfirmed
  const rec = { id: uid(), text, category, tags, sensitive, createdAt: now(), updatedAt: now(), lastRecalledAt: null };
  return saveVerified(STORES.memories, rec);
}

// Editing re-runs the gate whenever the text or tags change, so an edit cannot smuggle
// sensitive content past confirmation.
export async function updateMemory(id, changes, { confirmSensitive = false } = {}) {
  const cur = await get(STORES.memories, id);
  if (!cur) throw new Error('That memory no longer exists.');
  const next = { ...cur };
  if (changes.text !== undefined) next.text = String(changes.text).trim();
  if (changes.category !== undefined) next.category = CATEGORIES.includes(changes.category) ? changes.category : 'other';
  if (changes.tags !== undefined) next.tags = cleanTags(changes.tags);
  if (!next.text) throw new Error('Memory text cannot be empty.');
  if (next.text.length > MAX_TEXT) throw new Error(`That memory is too long (maximum ${MAX_TEXT} characters).`);
  const contentChanged = next.text !== cur.text || next.tags.join('|') !== (cur.tags || []).join('|');
  if (contentChanged) next.sensitive = gate([next.text, next.tags.join(' ')], confirmSensitive) || !!cur.sensitive;
  next.updatedAt = now();
  return saveVerified(STORES.memories, next);
}

export const deleteMemory = id => deleteVerified(STORES.memories, id);
export const listMemories = async () =>
  (await getAll(STORES.memories)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

// Retrieval: keyword scoring. (Semantic/embedding search is PLANNED for a later milestone.)
export async function searchMemories(query, limit = 5) {
  const q = new Set(tokenize(query));
  if (!q.size) return [];
  const all = await getAll(STORES.memories);
  const scored = all.map(m => {
    const words = new Set(tokenize(m.text));
    const tags = new Set((m.tags || []).flatMap(tokenize));
    let score = 0;
    for (const w of q) {
      if (words.has(w)) score += 2;
      if (tags.has(w)) score += 3;
      if (stem(m.category) === w) score += 1;
    }
    return { m, score };
  }).filter(x => x.score > 0);
  scored.sort((a, b) => b.score - a.score || b.m.updatedAt.localeCompare(a.m.updatedAt));
  return scored.slice(0, limit).map(x => x.m);
}
