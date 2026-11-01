// AUREN — js/app.js
// Connects the screen to the modules. All text is inserted with textContent (no HTML injection).
// v0.2: status banner for storage problems, session panel, privacy controls, safe backup import.

import { openDB, put, getAll, del, clear, healthCheck, storageEstimate, uid, STORES } from './db.js';
import * as Mem from './memory.js';
import * as Proj from './projects.js';
import { NeedsConfirmationError, historySafe, classify } from './sensitive.js';
import { Butler, isSessionNote } from './butler.js';
import { buildBackup, encryptBackup, decryptBackup, validateBackup, applyPlan, describeReport, LIMITS } from './backup.js';
import { loadSettings, saveSettings } from './settings.js';
import { createVoice } from './voice.js';
import { getAIEndpoint, setAIEndpoint, askAI } from './ai.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const butler = new Butler();
const settings = loadSettings();
const HISTORY_LIMIT = 200;
const aiRecent = [];
const aiEndpointInput = $('aiEndpoint');
aiEndpointInput.value = getAIEndpoint();
$('saveAIEndpoint').onclick = () => { try { setAIEndpoint(aiEndpointInput.value); showStatus('AUREN AI connection saved on this browser.', 'ok'); } catch (e) { showStatus(e.message, 'error'); } };
$('clearAIEndpoint').onclick = () => { setAIEndpoint(''); aiEndpointInput.value = ''; showStatus('AI connection removed.', 'info'); };
let storageOk = false, sinceTrim = 0;
// Keep live captions inside one fixed-size panel; long text never moves the orb.
function showCaption(speaker, content) {
  const panel = $('liveTranscript');
  const full = String(content || '').trim();
  // Keep the newest words visible while speaking, without changing the panel height.
  const MAX = 155;
  const visible = full.length > MAX ? '…' + full.slice(-MAX).trimStart() : full;
  panel.textContent = full ? `${speaker}: ${visible}` : '';
}
const voice = createVoice({
  onInterim: partial => showCaption('You', partial),
  onSpoken: progress => showCaption('AUREN', progress),
  onHeard: text => showCaption('You', text),
  onTranscript: async transcript => {
    $('chatInput').value = transcript;
    try { await send(transcript); }
    catch (error) {
      console.error('AUREN conversation request failed', error);
      showStatus('Voice request failed: ' + (error?.message || 'Unknown error'), 'error');
      throw error;
    }
  },
  onStatus: msg => {
    $('voiceStatus').textContent = msg;
    // Derive appearance from the actual microphone mode, never a status phrase.
    queueMicrotask(() => syncVoiceUI());
  }
});
function syncVoiceUI() {
  const listening = voice.listening;
  $('micBtn').textContent = listening ? '■ Stop listening' : '🎙 Speak to AUREN';
  $('micBtn').setAttribute('aria-pressed', String(listening));
  $('wakeBtn').textContent = voice.wakeMode ? '■ Stop “Hey Auren”' : 'Enable “Hey Auren”';
  $('wakeBtn').setAttribute('aria-pressed', String(voice.wakeMode));
  const message = $('voiceStatus').textContent || '';
  const speaking = voice.speaking || /AUREN speaking|speaking…/i.test(message);
  const thinking = /thinking|processing|requesting/i.test(message) || $('latestReply').textContent === 'Thinking…';
  const waitingWake = voice.wakeMode && !listening && !speaking && !thinking;
  const state = speaking ? 'speaking' : thinking ? 'processing' : listening ? 'listening' : 'idle';
  document.body.dataset.voiceState = state;
  $('heroState').textContent = speaking ? 'AUREN is speaking' : thinking ? 'AUREN is thinking' : listening ? (voice.wakeMode ? 'AUREN is listening' : 'Listening') : waitingWake ? 'Wake mode ready' : 'AUREN is asleep';
  $('wakeHint').hidden = speaking || thinking || listening;
  if (state === 'idle') $('aurenHeadline').textContent = 'At your service.';
  else if (state === 'listening') $('aurenHeadline').textContent = 'I’m listening.';
  else if (state === 'processing') $('aurenHeadline').textContent = 'One moment.';
  else if (state === 'speaking') $('aurenHeadline').textContent = 'Speaking…';
}

const capabilities = voice.available();
$('micBtn').disabled = !capabilities.listen;
$('speakReplies').disabled = !capabilities.speak;
$('stopSpeech').disabled = !capabilities.speak;
$('voiceStatus').textContent = capabilities.listen ? 'Tap the microphone to dictate a command.' : 'Microphone recognition unavailable in this browser; typing works.';
$('micBtn').onclick = () => {
  if (voice.listening) voice.stopListening();
  else voice.startListening();
  syncVoiceUI();
};
$('speakReplies').onchange = () => voice.setEnabled($('speakReplies').checked);
$('stopSpeech').onclick = () => voice.stopSpeaking();

// Voice-first dashboard and optional wake phrase (foreground only).
const advancedNav = $('advancedNav');
$('panelToggle').onclick = () => {
  // Settings goes straight to the settings panel. The navigation remains
  // available for Memory, Projects and Home.
  const isSettings = $('settings').classList.contains('active');
  const target = isSettings ? 'chat' : 'settings';
  advancedNav.hidden = isSettings;
  $('panelToggle').setAttribute('aria-expanded', String(!isSettings));
  const tab = document.querySelector(`nav button[data-tab="${target}"]`);
  if (tab) tab.click();
};
// One deliberate tap per action. Rapid repeated taps must never queue voices.
let lastOrbTap = 0;
$('orbControl').onclick = () => {
  const now = Date.now();
  if (now - lastOrbTap < 650) return;
  lastOrbTap = now;
  if (capabilities.speak) { voice.setEnabled(true); $('speakReplies').checked = true; }
  // If speaking, a tap stops the answer and opens the mic; no new speech is queued.
  if (voice.speaking) {
    voice.stopSpeaking();
    voice.stopListening();
    voice.startListening();
  } else $('micBtn').click();
  syncVoiceUI();
};
// Voice preview is intentionally removed: one voice, one simple main control.
$('wakeBtn').onclick = () => {
  if (capabilities.speak) voice.setEnabled(true);
  const active = voice.setWakeMode(!voice.wakeMode);
  if (active) voice.setEnabled(true);
  $('speakReplies').checked = voice.enabled;
  syncVoiceUI();
};
// A single curated British-butler voice. No voice picker or tuning controls.
// Keep the existing wake preference across upgrades. Microphone access still needs a tap.
const VOICE_PREFS_KEY = 'auren_voice_prefs_v12';
let savedWake = false;
try { savedWake = !!JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) || '{}').wake; } catch {}
function saveWakePreference() {
  try { localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({wake: savedWake})); } catch {}
}
voice.setVoicePreference(''); // Automatically choose the best available British voice.
voice.setVoiceStyle({rate: 0.94, pitch: 0.96});

// Keep the main screen focused on the orb. Secondary voice actions belong in Settings.
const voiceCard = document.createElement('div');
voiceCard.className = 'card';
const voiceHeading = document.createElement('h3');
voiceHeading.textContent = 'AUREN voice';
const voiceDescription = document.createElement('p');
voiceDescription.className = 'hint';
voiceDescription.textContent = 'One automatically selected British-butler voice. The sound depends on which voices Safari and macOS provide.';
voiceCard.append(voiceHeading, voiceDescription);
// Interruptions are off by default to prevent nearby conversations from
// cutting off AUREN. The setting is local to this browser and persists.
const INTERRUPTIONS_KEY = 'auren_interruptions_enabled_v1';
const interruptRow = document.createElement('label');
interruptRow.className = 'check';
interruptRow.style.marginTop = '16px';
const interruptToggle = document.createElement('input');
interruptToggle.type = 'checkbox';
interruptToggle.id = 'interruptionsToggle';
interruptToggle.checked = localStorage.getItem(INTERRUPTIONS_KEY) === 'true';
voice.setInterruptionsEnabled(interruptToggle.checked);
const interruptLabel = document.createElement('span');
interruptLabel.textContent = 'Allow interruptions while AUREN is speaking';
interruptRow.append(interruptToggle, interruptLabel);
const interruptHelp = document.createElement('p');
interruptHelp.className = 'hint';
interruptHelp.id = 'interruptionsHelp';
function syncInterruptionsHelp() {
  interruptHelp.textContent = interruptToggle.checked
    ? 'On — AUREN will try to hear you during replies. Nearby speech may occasionally interrupt it.'
    : 'Off (recommended in busy places) — AUREN finishes speaking before listening for the next question.';
}
interruptToggle.addEventListener('change', () => {
  const value = voice.setInterruptionsEnabled(interruptToggle.checked);
  try { localStorage.setItem(INTERRUPTIONS_KEY, String(value)); }
  catch { showStatus('This browser could not save the interruption preference.', 'error'); }
  syncInterruptionsHelp();
  showStatus(value ? 'Interruptions on. AUREN may pause for nearby speech.' : 'Interruptions off. AUREN will finish each reply.', 'info');
});
syncInterruptionsHelp();
voiceCard.append(interruptRow, interruptHelp);
$('wakeBtn').textContent = 'Enable “Hey Auren”';
$('settings').insertBefore(voiceCard, $('settings').firstElementChild);
// A clear customer-facing Settings screen. Advanced data tools are retained but collapsed.
// Never remove the existing DOM nodes: the application attaches handlers to them below.
const settingsPanel = $('settings');
const aiConnectionCard = aiEndpointInput.closest('.card');
const aiReady = !!getAIEndpoint();
if (aiReady) {
  // The connection is already saved in this browser. Hide technical setup and
  // the disconnect button; no one needs to touch it during ordinary use.
  aiConnectionCard.hidden = true;
  aiConnectionCard.style.display = 'none';
} else {
  aiConnectionCard.querySelector('h3').textContent = 'Finish setup';
  aiConnectionCard.querySelector('p').textContent = 'AUREN needs its AI connection before it can answer general questions.';
  $('clearAIEndpoint').hidden = true;
}
const simpleConnection = document.createElement('p');
simpleConnection.className = 'hint';
simpleConnection.textContent = aiReady ? 'AI connection ready' : 'AI connection not yet set up';
voiceCard.append(simpleConnection);
const privateDetails = document.createElement('details');
privateDetails.className = 'card';
privateDetails.id = 'dataPrivacyDetails';
const privateTitle = document.createElement('summary');
privateTitle.textContent = 'Your data & backups';
privateTitle.style.cursor = 'pointer';
privateTitle.style.color = 'var(--gold)';
privateTitle.style.padding = '4px 0';
privateDetails.append(privateTitle);
const dataIntro = document.createElement('p');
dataIntro.className = 'hint';
dataIntro.textContent = 'AUREN remembers information on this device. Here you can save a copy, restore it, or manage privacy.';
privateDetails.append(dataIntro);
// Keep the cards and their IDs intact, preserving all memory/backup handlers.
const storageCards = [...settingsPanel.querySelectorAll(':scope > .card')].filter(card => card !== voiceCard && card !== aiConnectionCard);
for (const card of storageCards) privateDetails.append(card);
settingsPanel.append(privateDetails);
// Avoid exposing dangerous deletion controls to casual clicks.
const deleteSection = privateDetails.querySelector('.danger');
if (deleteSection) {
  const deleteDetails = document.createElement('details');
  const deleteSummary = document.createElement('summary');
  deleteSummary.textContent = 'Erase device data (advanced)';
  deleteSummary.style.cursor = 'pointer';
  deleteDetails.append(deleteSummary, deleteSection);
  privateDetails.append(deleteDetails);
}

const oldWakeClick = $('wakeBtn').onclick;
$('wakeBtn').onclick = () => {
  oldWakeClick();
  savedWake = voice.wakeMode;
  saveWakePreference();
};
if (savedWake && capabilities.listen) {
  $('voiceStatus').textContent = 'Hey Auren is saved. Tap Enable “Hey Auren” once to activate the microphone.';
  $('wakeBtn').textContent = 'Resume “Hey Auren”';
}
const observer = new MutationObserver(syncVoiceUI);
observer.observe($('voiceStatus'), {childList:true,characterData:true,subtree:true});

// ---------- status banner (works on small screens; errors stay until dismissed) ----------
let statusTimer = null;
function showStatus(msg, level = 'info') {
  const bar = $('statusBar');
  $('statusMsg').textContent = msg;
  bar.className = level;
  bar.hidden = false;
  clearTimeout(statusTimer);
  if (level !== 'error') statusTimer = setTimeout(() => { bar.hidden = true; }, 7000);
}
$('statusClose').onclick = () => { $('statusBar').hidden = true; };

// Wrap every UI handler so a failure is shown to the person instead of vanishing.
const safe = fn => async (...args) => {
  try { return await fn(...args); }
  catch (e) { showStatus(e && e.message ? e.message : 'Something went wrong.', 'error'); }
};
window.addEventListener('unhandledrejection', e => { showStatus((e.reason && e.reason.message) || 'Something went wrong.', 'error'); });

// Run an action; if it needs confirmation for sensitive content, ask, then retry with consent.
async function withConfirm(run, verb = 'Save') {
  try { return await run(false); }
  catch (e) {
    if (e instanceof NeedsConfirmationError) {
      if (!confirm(`${e.message}\n\n${verb} it anyway?`)) { showStatus('Cancelled. Nothing was saved.', 'info'); return null; }
      return await run(true);
    }
    throw e;
  }
}

// ---------- tabs ----------
document.querySelectorAll('nav button').forEach(b => b.onclick = safe(async () => {
  document.querySelectorAll('nav button, .tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active'); $(b.dataset.tab).classList.add('active');
  if (b.dataset.tab !== 'chat') { advancedNav.hidden = false; $('panelToggle').setAttribute('aria-expanded', 'true'); }
  if (b.dataset.tab === 'memory') await renderMemories();
  if (b.dataset.tab === 'projects') await renderProjects();
  if (b.dataset.tab === 'settings') await renderStorageInfo();
}));

// ---------- chat ----------
function drawMessage(rec, opts = {}) {
  const d = el('div', `msg ${rec.role}${opts.err ? ' err' : ''}`, rec.text);
  if (opts.confirmToken) {
    const row = el('div', 'row');
    for (const [label, yes] of [['Yes', true], ['No', false]]) {
      const b = el('button', yes ? '' : 'ghost', label);
      b.type = 'button';
      b.onclick = safe(async () => { row.remove(); await answerConfirm(opts.confirmToken, yes, label); });
      row.append(b);
    }
    d.append(row);
  }
  $('log').append(d); $('log').scrollTop = $('log').scrollHeight;
  if (rec.role === 'auren') $('latestReply').textContent = rec.text;
}

// What goes to disk is redacted: sensitive/blocked text and session notes are never kept in history.
async function persistMessage(rec, { ephemeral = false } = {}) {
  if (!settings.saveHistory || !storageOk) return;
  const text = ephemeral ? '[session note — not kept in history]' : historySafe(rec.text);
  try {
    await put(STORES.messages, { ...rec, text });
    if (++sinceTrim >= 25) { sinceTrim = 0; await trimHistory(); }
  } catch (e) { showStatus('Could not save chat history: ' + e.message, 'error'); }
}
async function trimHistory() {
  const all = (await getAll(STORES.messages)).filter(m => m.role !== 'probe').sort((a, b) => a.at.localeCompare(b.at));
  for (const m of all.slice(0, Math.max(0, all.length - HISTORY_LIMIT))) await del(STORES.messages, m.id);
}

async function addMessage(role, text, opts = {}) {
  const rec = { id: uid(), role, text, at: new Date().toISOString() };
  drawMessage(rec, opts);
  if (role === 'auren' && !opts.err) voice.speak(text);
  await persistMessage(rec, opts);
}

async function presentResult(r) {
  await addMessage('auren', r.text, { confirmToken: r.confirm ? r.token : null, ephemeral: false });
  await Promise.all([renderMemories(), renderProjects()]);
  renderSession();
}

// Opt-in natural memory: explicit first-person durable preferences, interests and goals.
// This never automatically saves anything or forwards the detected statement to an AI service.
// Reject credential-like and sensitive statements rather than prompting on them.
function memoryCandidate(text) {
  const t = String(text).trim().replace(/[.!?]+$/, '');
  if (t.length < 10 || t.length > 220 || /[\n\r]/.test(t)) return null;
  if (/\b(?:today|tonight|tomorrow|yesterday|right now|for now|just now|at the moment)\b/i.test(t)) return null;
  if (!/^(?:i (?:really )?(?:like|love|enjoy|prefer|am interested in|am into|want to learn|want to become|plan to|hope to)|i'm (?:interested in|into|learning|working on)|my (?:favorite|favourite|goal is|hobby is|hobbies are|preferred))\b/i.test(t)) return null;
  const { blocked, sensitive } = classify(t);
  if (blocked.length || sensitive.length) return null;
  return t;
}

// Build a compact personal profile from verified, non-sensitive saved memories.
// Keyword-only lookup previously omitted broad interests when a question used different words.
async function contextForAI(question) {
  const all = (await Mem.listMemories()).filter(m => {
    if (m.sensitive || !m.text) return false;
    const scan = classify([m.text, ...(m.tags || [])].join(' '));
    return !scan.blocked.length && !scan.sensitive.length;
  });
  const matches = await Mem.searchMemories(question, 8);
  const generic = /\b(me|my|mine|myself|about me|you know|recommend|suggest|focus|priorit|interests|preferences|goals|what should i|what do you know)\b/i.test(question);
  const preferred = generic
    ? all.filter(m => ['preference', 'interest', 'goal', 'routine'].includes(m.category))
    : all.filter(m => ['preference', 'interest', 'goal'].includes(m.category));
  const chosen = [];
  const add = m => { if (m && !chosen.some(x => x.id === m.id)) chosen.push(m); };
  // Always send some stable preferences, as well as question-related facts.
  matches.slice(0, 3).forEach(add);
  preferred.slice(0, 5).forEach(add);
  matches.forEach(add);
  return {
    memories: chosen.slice(0, 8),
    session: butler.listSession().map(n => n.text).slice(0, 5)
  };
}

async function askWithMemory(question) {
  const context = await contextForAI(question);
  const answer = await askAI(question, context.memories, context.session, aiRecent);
  aiRecent.push({role:'user', content:question.slice(0,500)}, {role:'assistant', content:answer.slice(0,500)});
  if (aiRecent.length > 12) aiRecent.splice(0, aiRecent.length - 12);
  return answer;
}

// Handle explicit disputes about saved facts without arguing or fabricating provenance.
// A saved record proves only that AUREN currently has it, not who said it or when.
async function memoryDisputeReply(text) {
  const question = String(text || '').trim();
  const disputed = /\b(?:never (?:said|told|mentioned)|didn['’]t (?:say|tell|mention)|don't (?:like|enjoy|do|trade)|do not (?:like|enjoy|do|trade)|that's not true|that is not true|you(?:'re| are) (?:wrong|making (?:that|it) up)|i (?:never|don't) (?:say|said))\b/i.test(question);
  if (!disputed) return null;
  const memories = (await Mem.listMemories()).filter(m => m.text && !m.sensitive);
  const queryWords = new Set(Mem.tokenize(question).filter(w => ![
    'never','didnt','don','not','wrong','true','say','said','told','mention','make','making','up',
    'like','enjoy','know','think','fact','remember','memory','record','lie','lying','gaslight'
  ].includes(w)));
  const candidates = memories.map(m => ({
    memory:m,
    score: [...new Set(Mem.tokenize(m.text))].filter(w => queryWords.has(w)).length
  })).filter(x => x.score > 0).sort((a,b) => b.score - a.score);
  if (candidates.length === 0) {
    // No unambiguous match: don't claim a memory exists or that the user said it.
    return 'I may have misunderstood. I cannot verify that you said that. Which saved memory would you like me to check or correct?';
  }
  const best = candidates[0];
  if (candidates.length > 1 && best.score === candidates[1].score) {
    return 'I have more than one saved note that could relate to that. I cannot verify exactly what you said. Could you tell me which memory you want to review?';
  }
  return `I have this saved in memory: “${best.memory.text.slice(0, 240)}”. That only tells me what is stored, not whether you actually said it or whether it is still accurate. Would you like me to correct or delete that memory?`;
}

async function send(text) {
  if (voice.available().speak && !voice.enabled) { voice.setEnabled(true); $('speakReplies').checked = true; }
  await addMessage('user', text, { ephemeral: isSessionNote(text) });
  try {
    // Verified save/delete/project operations remain local. Other conversation goes to AI.
    // Only verified local actions bypass AI. General questions about the user,
    // interests, and recommendations should reach the AI with saved memory context.
    const isLocal = /^(?:help\s*[!?]?|for now\b|just for now\b|this session\b|for this session\b|clear (?:the )?session\b|save session note\b|session\b|what are we working on\b|what am i working on\b|(?:please )?remember\b|search memory for\b|forget\b|new project\b|start project\b|create project\b|project\b|projects\b|list projects\b|yes\s*[.!]?|no\s*[.!]?|confirm\s*[.!]?|cancel\s*[.!]?)$/i.test(text.trim())
      || /^(?:please )?remember\s+/i.test(text)
      || /^(?:forget|new project|start project|create project|project)\s+/i.test(text)
      || /^(?:for now|just for now|this session|for this session|save session note)\s+/i.test(text);
    const memoryDispute = isLocal ? null : await memoryDisputeReply(text);
    if (isLocal) {
      await presentResult(await butler.handle(text));
    } else if (memoryDispute) {
      await addMessage('auren', memoryDispute);
    } else if (!getAIEndpoint()) {
      await addMessage('auren', 'I can see your saved memories, but my AI connection is not configured on this browser. Connect my Cloudflare AI service in Settings so I can answer personal questions and make recommendations.');
    } else if (memoryCandidate(text)) {
      const candidate = memoryCandidate(text);
      const alreadySaved = (await Mem.listMemories()).some(m => m.text.toLowerCase() === candidate.toLowerCase());
      if (alreadySaved) {
        const answer = await askWithMemory(text);
        await addMessage('auren', answer);
      } else {
        // AUREN asks permission before adding a lasting fact; no data leaves the browser.
        await presentResult(butler.ask({type:'save', payload:{text:candidate, category:Mem.guessCategory(candidate)}},
          `Shall I remember that for future conversations, sir?\n“${candidate}”\nNothing has been saved yet.`));
      }
    } else {
      $('latestReply').textContent = 'Thinking…';
      const answer = await askWithMemory(text);
      await addMessage('auren', answer);
    }
  } catch (e) {
    // Make request failures audible too; previously err:true suppressed voice output,
    // so users heard silence and had no clue whether the Worker had responded.
    console.error('AUREN AI request failed:', e);
    const detail = e?.message || 'Unknown connection problem';
    const spoken = /abort|timeout/i.test(detail)
      ? 'My AI service took too long to respond. Please try again.'
      : /Failed to fetch|NetworkError|Load failed|fetch/i.test(detail)
        ? 'I cannot reach my AI service. Please check the connection in Settings.'
        : /Connect your free AI Worker|not connected/i.test(detail)
          ? 'My AI connection is not configured on this browser. Please connect it in Settings.'
          : 'My AI service returned an error. You can find the details on screen.';
    await addMessage('auren', spoken, { err: true });
    voice.speak(spoken);
    showStatus('AI response failed: ' + detail, 'error');
    renderSession();
  }
}
async function answerConfirm(token, yes, label) {
  await addMessage('user', label);
  try { await presentResult(await butler.answer(token, yes)); }
  catch (e) { await addMessage('auren', 'I regret to say that failed: ' + e.message, { err: true }); showStatus(e.message, 'error'); }
}
$('chatForm').onsubmit = e => { e.preventDefault(); const v = $('chatInput').value.trim(); if (v) { $('chatInput').value = ''; safe(send)(v); } };

async function loadHistory() {
  const msgs = (await getAll(STORES.messages)).filter(m => m.role === 'user' || m.role === 'auren').sort((a, b) => a.at.localeCompare(b.at));
  if (!msgs.length) return addMessage('auren', "I'm here when you need me. Tap the orb to talk, or open settings for your memories.");
  msgs.forEach(m => drawMessage(m));
}

// ---------- session notes panel ----------
function renderSession() {
  const box = $('sessionList'); box.replaceChildren();
  const notes = butler.listSession();
  if (!notes.length) box.append(el('p', 'hint', 'None. Try: for now, I\'m working on the ebook cover'));
  notes.forEach((n, i) => {
    const row = el('div', 'snote'); row.append(el('span', null, `${i + 1}. ${n.text}`));
    const save = el('button', 'ghost', 'Keep forever');
    save.onclick = safe(async () => { await presentResult(await butler.promoteSessionNote(i)); });
    const rm = el('button', 'ghost', '✕'); rm.setAttribute('aria-label', 'Remove note');
    rm.onclick = () => { butler.removeSession(i); renderSession(); };
    row.append(save, rm); box.append(row);
  });
  $('sessionClear').hidden = !notes.length;
}
$('sessionClear').onclick = () => { butler.clearSession(); renderSession(); };

// ---------- memory dashboard ----------
function fillSelect(sel, withAll) {
  sel.replaceChildren();
  if (withAll) sel.append(new Option('All categories', ''));
  Mem.CATEGORIES.forEach(c => sel.append(new Option(c, c)));
}
fillSelect($('memCat'), false); fillSelect($('memFilter'), true);

function resetMemForm() { $('memForm').reset(); $('memId').value = ''; $('memCancel').hidden = true; $('memSave').textContent = 'Save memory'; }
$('memCancel').onclick = resetMemForm;

$('memForm').onsubmit = e => {
  e.preventDefault();
  safe(async () => {
    const id = $('memId').value;
    const data = { text: $('memText').value, category: $('memCat').value, tags: $('memTags').value.split(',') };
    const saved = await withConfirm(c => id ? Mem.updateMemory(id, data, { confirmSensitive: c }) : Mem.createMemory({ ...data, confirmSensitive: c }));
    if (!saved) return;
    resetMemForm(); await renderMemories();
    showStatus(id ? 'Memory updated and verified.' : 'Memory saved and verified.', 'ok');
  })();
};
$('memSearch').oninput = safe(renderMemories); $('memFilter').onchange = safe(renderMemories);

async function renderMemories() {
  const q = $('memSearch').value.trim(), cat = $('memFilter').value;
  let list = q ? await Mem.searchMemories(q, 100) : await Mem.listMemories();
  if (cat) list = list.filter(m => m.category === cat);
  const box = $('memList'); box.replaceChildren();
  if (!list.length) box.append(el('p', 'hint', 'No memories to show.'));
  for (const m of list) {
    const d = el('div', 'item');
    d.append(el('span', 'tag', m.category), el('span', null, m.text));
    d.append(el('div', 'meta', [m.sensitive ? 'sensitive' : '', (m.tags || []).length ? 'tags: ' + m.tags.join(', ') : '', 'updated ' + new Date(m.updatedAt).toLocaleString()].filter(Boolean).join(' · ')));
    const a = el('div', 'actions');
    const edit = el('button', 'ghost', 'Edit'), rm = el('button', 'ghost', 'Delete');
    edit.onclick = () => { $('memId').value = m.id; $('memText').value = m.text; $('memCat').value = m.category; $('memTags').value = (m.tags || []).join(', ');
      $('memCancel').hidden = false; $('memSave').textContent = 'Update memory'; $('memText').focus(); };
    rm.onclick = safe(async () => { if (confirm('Delete this memory permanently?')) { await Mem.deleteMemory(m.id); await renderMemories(); showStatus('Memory deleted.', 'ok'); } });
    a.append(edit, rm); d.append(a); box.append(d);
  }
}

// ---------- projects ----------
$('projForm').onsubmit = e => {
  e.preventDefault();
  safe(async () => {
    const p = await withConfirm(c => Proj.createProject($('projName').value, { confirmSensitive: c }), 'Create');
    if (!p) return;
    $('projForm').reset(); await renderProjects(); showStatus('Project saved and verified.', 'ok');
  })();
};
async function renderProjects() {
  const box = $('projList'); box.replaceChildren();
  const list = await Proj.listProjects();
  if (!list.length) box.append(el('p', 'hint', 'No projects yet.'));
  for (const p of list) {
    const d = el('div', 'item');
    d.append(el('b', null, p.name), el('span', 'meta', `  ${p.status} · ${p.progress}%${p.sensitive ? ' · sensitive' : ''}`));
    const bar = el('div', 'bar'), fill = el('i'); fill.style.width = p.progress + '%'; bar.append(fill); d.append(bar);
    const slider = document.createElement('input'); slider.type = 'range'; slider.min = 0; slider.max = 100; slider.value = p.progress;
    slider.setAttribute('aria-label', 'Progress');
    slider.onchange = safe(async () => { const v = Number(slider.value); await Proj.updateProject(p.id, { progress: v, status: v >= 100 ? 'done' : (p.status === 'done' ? 'active' : p.status) }); await renderProjects(); });
    d.append(slider);
    (p.notes || []).slice(-3).forEach(n => d.append(el('div', 'meta', `${new Date(n.at).toLocaleDateString()}: ${n.text}`)));
    const note = document.createElement('input'); note.placeholder = 'Add a note and press Enter'; note.maxLength = 1000;
    note.onkeydown = e => { if (e.key === 'Enter' && note.value.trim()) safe(async () => {
      const r = await withConfirm(c => Proj.addProjectNote(p.id, note.value, { confirmSensitive: c }), 'Add');
      if (r) { await renderProjects(); showStatus('Note saved and verified.', 'ok'); } })(); };
    const rm = el('button', 'ghost', 'Delete project');
    rm.onclick = safe(async () => { if (confirm(`Delete "${p.name}"?`)) { await Proj.deleteProject(p.id); await renderProjects(); showStatus('Project deleted.', 'ok'); } });
    const actions = el('div', 'actions'); actions.append(rm);
    d.append(note, actions); box.append(d);
  }
}

// ---------- privacy & backup ----------
$('saveHistory').onchange = () => {
  settings.saveHistory = $('saveHistory').checked;
  if (!saveSettings(settings)) showStatus('Could not remember this setting (browser storage is restricted).', 'error');
  else showStatus(settings.saveHistory ? 'Chat history will be kept on this device.' : 'Chat history will no longer be saved. Existing history stays until you clear it.', 'info');
};

$('exportBtn').onclick = safe(async () => {
  const includeSensitive = $('expSensitive').checked, pass = $('expPass').value;
  if (includeSensitive && !pass && !confirm('This backup will include sensitive memories as PLAIN, READABLE text. Continue without a passphrase?')) return;
  const data = buildBackup({ memories: await Mem.listMemories(), projects: await Proj.listProjects() }, { includeSensitive });
  const out = pass ? await encryptBackup(data, pass) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  a.download = `auren-backup-${new Date().toISOString().slice(0, 10)}${pass ? '-encrypted' : ''}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  const om = data.omitted;
  showStatus(`Backup exported${pass ? ' (encrypted)' : ''}: ${data.memories.length} memories, ${data.projects.length} projects.` +
    (om.memories || om.projects ? ` ${om.memories} sensitive memories and ${om.projects} sensitive projects were left out.` : ''), 'ok');
});

$('importFile').onchange = e => {
  const input = e.target, f = input.files && input.files[0];
  safe(async () => {
    if (!f) return;
    if (f.size > LIMITS.fileBytes) throw new Error(`That file is too large to be an AUREN backup (limit ${LIMITS.fileBytes / 1024 / 1024} MB).`);
    let data;
    try { data = JSON.parse(await f.text()); } catch { throw new Error('That file is not valid JSON, so it cannot be an AUREN backup.'); }
    if (data && data.encrypted) data = await decryptBackup(data, $('impPass').value);
    const [mems, projs] = await Promise.all([Mem.listMemories(), Proj.listProjects()]);
    const { plan, report } = validateBackup(data, { memories: new Map(mems.map(m => [m.id, m])), projects: new Map(projs.map(p => [p.id, p])) });
    const summary = describeReport(report);
    if (!plan.memories.length && !plan.projects.length) { showStatus('Nothing to import.\n' + summary, 'info'); return; }
    if (!confirm(`Import this backup?\n\n${summary}\n\nNothing has been changed yet.`)) { showStatus('Import cancelled. Nothing was changed.', 'info'); return; }
    await applyPlan(plan);
    await Promise.all([renderMemories(), renderProjects()]);
    showStatus(`Import complete and verified: ${plan.memories.length} memories, ${plan.projects.length} projects written.`, 'ok');
  })().finally(() => { try { input.value = ''; } catch { /* ignore */ } });
};

$('clearChat').onclick = safe(async () => {
  if (!confirm('Clear chat history? Memories and projects are kept.')) return;
  await clear(STORES.messages); $('log').replaceChildren(); await loadHistory(); showStatus('Chat history cleared.', 'ok');
});

$('wipeConfirm').oninput = () => { $('wipeBtn').disabled = $('wipeConfirm').value.trim() !== 'DELETE'; };
$('wipeBtn').onclick = safe(async () => {
  if ($('wipeConfirm').value.trim() !== 'DELETE') return;
  if (!confirm('This permanently erases ALL AUREN data on this device. Are you sure?')) return;
  await Promise.all(Object.values(STORES).map(s => clear(s)));
  butler.clearSession(); butler.pending = null;
  $('wipeConfirm').value = ''; $('wipeBtn').disabled = true; $('log').replaceChildren();
  await loadHistory(); await Promise.all([renderMemories(), renderProjects()]); renderSession();
  showStatus('All AUREN data on this device has been deleted.', 'ok');
});

async function renderStorageInfo() {
  const est = await storageEstimate();
  $('usageStatus').textContent = est && est.quota
    ? `Using about ${(est.usage / 1048576).toFixed(2)} MB of roughly ${(est.quota / 1048576).toFixed(0)} MB available to this site.`
    : 'Storage usage is not reported by this browser.';
}

// ---------- start ----------
(async function init() {
  $('saveHistory').checked = settings.saveHistory;
  try {
    await openDB();
    await healthCheck();           // prove we can really write, read back and delete
    storageOk = true;
    $('status').textContent = 'memory online';
  } catch (e) {
    $('status').textContent = 'storage problem — nothing will be saved';
    showStatus('Storage problem: ' + e.message + ' AUREN will not save anything until this is fixed.', 'error');
    return;
  }
  let persisted = false;
  try { const s = navigator.storage; if (s && s.persist) persisted = await s.persist(); } catch { /* ignore */ }
  $('persistStatus').textContent = persisted
    ? 'Storage is marked persistent: the browser should not clear it automatically.'
    : 'The browser has not guaranteed persistent storage, so it could clear AUREN\'s data if the device runs low on space. Export a backup regularly.';
  try {
    await trimHistory();
    await loadHistory(); await renderMemories(); await renderProjects(); renderSession(); await renderStorageInfo();
  } catch (e) { showStatus('Could not load saved data: ' + e.message, 'error'); }
})();
