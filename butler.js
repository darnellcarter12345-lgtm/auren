// AUREN — js/butler.js
// Milestone 1 "brain": a RULE-BASED command interpreter (no AI model yet — that is PLANNED).
// v0.2: session notes are actually used (recall, "what are we working on", context for a future AI),
//       confirmations are tokenised + expiring + strict, and all saves go through the shared gate.

import * as Mem from './memory.js';
import * as Proj from './projects.js';
import { BlockedContentError, NeedsConfirmationError } from './sensitive.js';
import { uid } from './db.js';

const short = id => id.slice(0, 8);
const CONFIRM_TTL_MS = 2 * 60 * 1000;
const MAX_SESSION = 20, MAX_SESSION_NOTE = 500;

export const SESSION_RE = /^(?:for now|just for now|this session|for this session)[,:]?\s+(.+)/i;
export const isSessionNote = t => SESSION_RE.test(String(t).trim());
// Strict: the WHOLE message must be a yes/no, so "yes, also remember my password…" confirms nothing.
const YES = /^(y|yes|confirm|go ahead|please do)[.!]?$/i;
const NO = /^(n|no|cancel|stop|don'?t|do not)[.!]?$/i;

export class Butler {
  constructor() {
    this.pending = null;   // {type, payload, token, expires} — an action waiting for yes/no
    this.session = [];     // TEMPORARY notes: [{text, at}] — memory only, never written to disk
  }

  // ---- session notes (temporary context) ----
  listSession() { return this.session.slice(); }
  addSession(text) {
    text = text.trim();
    if (!text) return { text: 'There was nothing to note, sir.' };
    if (text.length > MAX_SESSION_NOTE) return { text: `That is too long for a session note (maximum ${MAX_SESSION_NOTE} characters).`, ephemeral: true };
    if (this.session.length >= MAX_SESSION) this.session.shift();
    this.session.push({ text, at: new Date().toISOString() });
    return { text: 'Understood. I will bear that in mind for this conversation only — it is not saved to long-term memory, and it is gone when you reload.', ephemeral: true };
  }
  removeSession(i) { if (i >= 0 && i < this.session.length) this.session.splice(i, 1); }
  clearSession() { const n = this.session.length; this.session = []; return n; }
  sessionMatches(query, limit = 3) {
    const q = new Set(Mem.tokenize(query));
    if (!q.size) return [];
    return this.session
      .map(n => ({ n, s: Mem.tokenize(n.text).filter(w => q.has(w)).length }))
      .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, limit).map(x => x.n);
  }
  // The hook a future AI model will call to build its prompt: session notes + relevant memories.
  async getContext(query) {
    return { session: this.session.map(n => n.text), memories: await Mem.searchMemories(query, 5) };
  }
  async promoteSessionNote(i) {
    const n = this.session[i];
    if (!n) return { text: 'There is no such session note, sir.' };
    return this.proposeSave(n.text);
  }

  // ---- main entry ----
  async handle(input) {
    const text = input.trim();
    if (!text) return { text: 'I am listening, sir.' };

    if (this.pending) {
      if (YES.test(text)) return this.answer(this.pending.token, true);
      if (NO.test(text)) return this.answer(this.pending.token, false);
      this.pending = null; // a new instruction replaces the old question
    } else if (YES.test(text) || NO.test(text)) {
      return { text: 'There is nothing awaiting your confirmation.' };
    }

    let m;
    if (/^(help|\?|what can you do)\b/i.test(text)) return this.help();

    if ((m = text.match(SESSION_RE))) return this.addSession(m[1]);
    if (/^clear (the )?session\b/i.test(text)) return { text: `Session notes cleared (${this.clearSession()} removed). Your long-term memories are untouched.` };
    if ((m = text.match(/^save session note\s+(\d+)\b/i))) return this.promoteSessionNote(Number(m[1]) - 1);
    if (/^(?:show |list )?(?:the )?session(?: notes)?$|^what are we (?:working on|doing)\??$|^what am i working on\??$/i.test(text)) return this.overview();

    if ((m = text.match(/^(?:please\s+)?remember(?:\s+that)?[:,]?\s+(.+)/i))) return this.proposeSave(m[1]);
    if ((m = text.match(/^(?:what do you (?:remember|know) about|recall|do you remember|search memory for)\s+(.+?)\??$/i))) return this.recall(m[1]);
    if ((m = text.match(/^forget(?:\s+that)?\s+(.+)/i))) return this.proposeForget(m[1]);

    if ((m = text.match(/^(?:new|start|create) project[:\s]+(.+)/i))) return this.newProject(m[1]);
    if ((m = text.match(/^project\s+(.+?)\s+(?:progress|is)\s+(\d{1,3})\s*%?$/i))) {
      const p = await Proj.findProject(m[1]);
      if (!p) return { text: `I have no project matching "${m[1]}", sir.` };
      const pct = Math.min(100, Number(m[2]));
      const u = await Proj.updateProject(p.id, { progress: pct, status: pct >= 100 ? 'done' : p.status });
      return { text: `"${u.name}" is now at ${u.progress}% (saved and verified).` };
    }
    if ((m = text.match(/^project\s+(.+?)\s+note[:\s]+(.+)/i))) return this.projectNote(m[1], m[2]);
    if (/^(?:list )?projects$/i.test(text)) {
      const ps = await Proj.listProjects();
      if (!ps.length) return { text: 'No projects on file yet. Try: "new project Lucid Traders".' };
      return { text: ps.map(p => `• ${p.name} — ${p.progress}% (${p.status})`).join('\n') };
    }
    return this.fallback(text);
  }

  help() {
    return { text:
`I can do these now (rule-based; no AI model is connected yet):
• remember that I prefer dark mode
• remember goal: launch my clothing line this year
• what do you remember about trading?
• forget <words from the memory>
• for now, I'm working on the ebook cover   (this conversation only — not saved)
• session  /  what are we working on  /  save session note 1  /  clear session
• new project Overdrive  /  project Overdrive progress 40  /  project Overdrive note: fixed lag
• projects
Sensitive details (health, money, contact, etc.) are saved only after you say yes. Passwords and card numbers are never saved.
Planned, not built yet: voice, AI conversation, reminders, daily briefings, research.` };
  }

  async overview() {
    const parts = [];
    parts.push(this.session.length
      ? 'This conversation (temporary):\n' + this.session.map((n, i) => `${i + 1}. ${n.text}`).join('\n')
      : 'No session notes yet. Try: "for now, I\'m working on the ebook cover".');
    const active = (await Proj.listProjects()).filter(p => p.status === 'active');
    if (active.length) parts.push('Active projects:\n' + active.map(p => `• ${p.name} — ${p.progress}%`).join('\n'));
    return { text: parts.join('\n\n') };
  }

  ask(pending, text) {
    this.pending = { ...pending, token: uid(), expires: Date.now() + CONFIRM_TTL_MS };
    return { text, confirm: true, token: this.pending.token };
  }

  async proposeSave(raw) {
    let category = null, body = raw.trim();
    const cm = body.match(/^(\w+):\s+(.+)/);
    if (cm && Mem.CATEGORIES.includes(cm[1].toLowerCase())) { category = cm[1].toLowerCase(); body = cm[2]; }
    category = category || Mem.guessCategory(body);
    try {
      const rec = await Mem.createMemory({ text: body, category });
      return { text: `Very good. Saved as "${rec.category}" and verified in the database (ref ${short(rec.id)}).` };
    } catch (e) {
      if (e instanceof BlockedContentError) return { text: `I must decline, sir — ${e.reasons[0]}. Nothing was saved. A password manager is the right place for it.` };
      if (e instanceof NeedsConfirmationError) return this.ask({ type: 'save', payload: { text: body, category } },
        `That touches on personal information (${e.reasons.join(', ')}). Shall I save it as a "${category}" memory? Nothing has been saved yet.`);
      throw e;
    }
  }

  async newProject(name) {
    try {
      const p = await Proj.createProject(name);
      return { text: `Project "${p.name}" is now on file (verified in the database, ref ${short(p.id)}). Progress 0%.` };
    } catch (e) {
      if (e instanceof BlockedContentError) return { text: `I must decline, sir — ${e.reasons[0]}. Nothing was saved.` };
      if (e instanceof NeedsConfirmationError) return this.ask({ type: 'project', payload: { name } },
        `That project name touches on personal information (${e.reasons.join(', ')}). Create it anyway? Nothing has been saved yet.`);
      throw e;
    }
  }

  async projectNote(nameFragment, noteText) {
    const p = await Proj.findProject(nameFragment);
    if (!p) return { text: `I have no project matching "${nameFragment}", sir.` };
    try {
      await Proj.addProjectNote(p.id, noteText);
      return { text: `Noted against "${p.name}" (saved and verified).` };
    } catch (e) {
      if (e instanceof BlockedContentError) return { text: `I must decline, sir — ${e.reasons[0]}. Nothing was saved.` };
      if (e instanceof NeedsConfirmationError) return this.ask({ type: 'note', payload: { id: p.id, text: noteText } },
        `That note touches on personal information (${e.reasons.join(', ')}). Add it to "${p.name}" anyway? Nothing has been saved yet.`);
      throw e;
    }
  }

  async recall(query) {
    const hits = await Mem.searchMemories(query);
    const sess = this.sessionMatches(query);
    if (!hits.length && !sess.length) return { text: `I find nothing on file about "${query}", sir.` };
    const lines = [];
    if (sess.length) lines.push(...sess.map(n => `• (this conversation, temporary) ${n.text}`));
    if (hits.length) lines.push(...hits.map(h => `• [${h.category}] ${h.text}`));
    return { text: `Here is what I have on "${query}":\n` + lines.join('\n') };
  }

  async proposeForget(query) {
    const [hit] = await Mem.searchMemories(query, 1);
    if (!hit) return { text: `I could not find a memory matching "${query}". Nothing was deleted.` };
    return this.ask({ type: 'delete', payload: { id: hit.id } }, `Delete this memory?\n"${hit.text}"`);
  }

  // Called with the token of the question being answered, so an old button can never
  // confirm a newer question.
  async answer(token, yes) {
    const p = this.pending;
    if (!p || p.token !== token) return { text: 'That question has expired or was already answered. Nothing was changed.' };
    this.pending = null;
    if (Date.now() > p.expires) return { text: 'That confirmation timed out. Nothing was changed — please ask again.' };
    if (!yes) return { text: 'Very well. Nothing was changed.' };
    switch (p.type) {
      case 'save': { const r = await Mem.createMemory({ ...p.payload, confirmSensitive: true }); return { text: `Saved and verified (ref ${short(r.id)}). Discretion assured.` }; }
      case 'project': { const r = await Proj.createProject(p.payload.name, { confirmSensitive: true }); return { text: `Project "${r.name}" created and verified.` }; }
      case 'note': { await Proj.addProjectNote(p.payload.id, p.payload.text, { confirmSensitive: true }); return { text: 'Note added and verified.' }; }
      case 'delete': { await Mem.deleteMemory(p.payload.id); return { text: 'Deleted, and confirmed gone from the database.' }; }
      default: return { text: 'There was nothing pending.' };
    }
  }

  // Where a language model will connect in a later milestone (it will receive getContext()).
  async fallback(text) {
    const hits = await Mem.searchMemories(text, 3);
    const sess = this.sessionMatches(text);
    const base = 'I am not yet connected to a language model (that is planned), so I can only act on the commands listed under "help".';
    if (!hits.length && !sess.length) {
      return { text: base + (this.session.length ? `\nI am keeping ${this.session.length} session note(s) in mind; type "session" to review them.` : '') };
    }
    const lines = [...sess.map(n => `• (this conversation) ${n.text}`), ...hits.map(h => `• ${h.text}`)];
    return { text: base + '\nThese notes may be relevant:\n' + lines.join('\n') };
  }
}
