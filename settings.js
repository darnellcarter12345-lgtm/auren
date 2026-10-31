// AUREN — js/settings.js
// Tiny preferences store (localStorage). Never holds memories — only on/off switches.
const KEY = 'auren.settings';
const DEFAULTS = { saveHistory: true };

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { saveHistory: typeof raw.saveHistory === 'boolean' ? raw.saveHistory : DEFAULTS.saveHistory };
  } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify({ saveHistory: !!s.saveHistory })); return true; }
  catch { return false; }
}
