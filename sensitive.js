// AUREN — js/sensitive.js
// ONE gate that every save path uses (memories, projects, notes, imports).
// - BLOCKED: never stored, even if you ask (credentials, card/SSN-like numbers).
// - SENSITIVE: stored only after an explicit confirmation.

const BLOCKED = [
  { re: /\b\d{3}-?\d{2}-?\d{4}\b/, why: 'it looks like a Social Security number' },
  { re: /\b(?:\d[ -]?){13,19}\b/, why: 'it looks like a card or account number' },
  { re: /\b(password|passcode|passphrase|pin code|api key|secret key|seed phrase|private key)\b/i, why: 'it looks like a credential' },
];

const SENSITIVE = [
  { re: /\b(diagnos\w*|medicat\w*|prescri\w*|therap\w*|anxiety|depress\w*|illness|allerg\w*|surgery|doctor|medical)\b/i, why: 'health' },
  { re: /\b(salary|income|debt|loan|credit score|net worth|owe|owes|bankrupt\w*|bank|savings)\b/i, why: 'financial' },
  { re: /\b(religio\w*|church|mosque|faith|politic\w*|democrat|republican)\b/i, why: 'beliefs' },
  { re: /\b(gay|lesbian|bisexual|sexual\w*|dating)\b/i, why: 'relationships or identity' },
  { re: /\b(arrest\w*|lawsuit|probation|criminal|police)\b/i, why: 'legal' },
  { re: /\b(home address|lives at|phone number|\d{3}[-. ]\d{3}[-. ]\d{4})\b/i, why: 'contact or location' },
];

export function classify(text) {
  const t = String(text || '');
  const blocked = BLOCKED.filter(r => r.re.test(t)).map(r => r.why);
  const sensitive = [...new Set(SENSITIVE.filter(r => r.re.test(t)).map(r => r.why))];
  return { blocked, sensitive };
}

export class BlockedContentError extends Error {
  constructor(reasons) {
    super(`I can't store that — ${reasons[0]}. Nothing was saved. A password manager is the right place for it.`);
    this.name = 'BlockedContentError'; this.reasons = reasons;
  }
}
export class NeedsConfirmationError extends Error {
  constructor(reasons) {
    super(`This looks like personal information (${reasons.join(', ')}) and needs your confirmation before it is saved.`);
    this.name = 'NeedsConfirmationError'; this.reasons = reasons;
  }
}

// Check several strings at once. Returns true if the content is sensitive AND was confirmed.
// Throws BlockedContentError / NeedsConfirmationError otherwise. Callers cannot skip this.
export function gate(texts, confirmed = false) {
  const blocked = [], sens = new Set();
  for (const t of texts) {
    const c = classify(t);
    blocked.push(...c.blocked);
    c.sensitive.forEach(s => sens.add(s));
  }
  if (blocked.length) throw new BlockedContentError(blocked);
  if (sens.size && !confirmed) throw new NeedsConfirmationError([...sens]);
  return sens.size > 0;
}

// Text that must never be kept in saved chat history.
export function historySafe(text) {
  const c = classify(text);
  if (c.blocked.length) return '[message withheld: it contained credential-like data]';
  if (c.sensitive.length) return `[sensitive content (${c.sensitive.join(', ')}) — not kept in history]`;
  return text;
}
