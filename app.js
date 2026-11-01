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
  const waitingWake = voice.wakeMode && !voice.awake && !speaking && !thinking;
  const state = speaking ? 'speaking' : thinking ? 'processing' : voice.awake ? 'listening' : 'idle';
  document.body.dataset.voiceState = state;
  $('heroState').textContent = speaking ? 'AUREN is speaking' : thinking ? 'AUREN is thinking' : voice.awake ? 'Listening' : 'AUREN is asleep';
  $('heroState').hidden = state === 'idle';
  $('wakeHint').hidden = state !== 'idle';
  if (state === 'idle') $('aurenHeadline').textContent = 'At your service.';
  else if (state === 'listening') $('aurenHeadline').textContent = 'I’m listening.';
  else if (state === 'processing') $('aurenHeadline').textContent = 'One moment.';
  else if (state === 'speaking') $('aurenHeadline').textContent = 'Speaking…';
}

const capabilities = voice.available();
$('micBtn').disabled = !capabilities.listen;
$('speakReplies').disabled = !capabilities.speak;
$('stopSpeech').disabled = !capabilities.speak;
$('voiceStatus').textContent = capabilities.listen ? 'Tap the orb once to activate voice. Safari may require this after each visit.' : 'Microphone recognition unavailable in this browser; typing works.';
$('micBtn').onclick = () => {
  if (voice.listening) voice.stopListening();
  else voice.startListening();
  syncVoiceUI();
};
$('speakReplies').onchange = () => voice.setEnabled($('speakReplies').checked);
$('stopSpeech').onclick = () => voice.stopSpeaking();

// Voice-first dashboard and optional wake phrase (foreground only).
const advancedNav = $('advancedNav');
// One screen controller: the gear never triggers another navigation click.
let lastNonSettingsScreen = 'chat';
async function activateScreen(screen) {
  const target = document.getElementById(screen);
  if (!target || !target.classList.contains('tab')) return;
  if (screen !== 'settings') lastNonSettingsScreen = screen;
  document.querySelectorAll('nav button, .tab').forEach(node => node.classList.remove('active'));
  target.classList.add('active');
  const tab = document.querySelector(`nav button[data-tab="${screen}"]`);
  if (tab) tab.classList.add('active');
  document.body.dataset.screen = screen;
  const inSettings = screen === 'settings';
  advancedNav.hidden = !inSettings;
  $('panelToggle').setAttribute('aria-expanded', String(inSettings));
  $('panelToggle').setAttribute('aria-label', inSettings ? 'Close Settings' : 'Open Settings');
  $('panelToggle').textContent = inSettings ? '✕' : '⚙';
  if (screen === 'memory') await renderMemories();
  if (screen === 'projects') await renderProjects();
  if (inSettings) await renderStorageInfo();
  if (screen === 'planner') renderDay();
  window.scrollTo({top:0,behavior:'instant'});
}
$('panelToggle').addEventListener('click', (event) => {
  event.preventDefault();
  const settingsOpen = document.body.dataset.screen === 'settings';
  void activateScreen(settingsOpen ? lastNonSettingsScreen : 'settings');
});
// Direct click actions are synchronous to preserve Safari's microphone gesture permission.
let lastOrbTap = 0;
$('orbControl').addEventListener('click', () => {
  const now = Date.now();
  if (now - lastOrbTap < 220) return; // suppress accidental double-taps only
  lastOrbTap = now;
  if (!capabilities.listen) {
    showStatus('Microphone recognition is unavailable here. You can still type in Text chat.', 'error');
    return;
  }
  try {
    if (capabilities.speak) { voice.setEnabled(true); $('speakReplies').checked = true; }
    if (voice.speaking) {
      // Stop the reply first, then listen for the correction on this same user gesture.
      voice.stopSpeaking();
      voice.startListening();
    } else if (voice.awake) {
      voice.setWakeMode(true); // sleep; keep wake phrase on where supported
    } else {
      voice.startListening(); // awaken immediately, without waiting for a wake phrase
    }
    syncVoiceUI();
  } catch (error) {
    showStatus('Could not activate the microphone: ' + (error?.message || 'browser permission denied'), 'error');
  }
});
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
document.querySelectorAll('nav button').forEach(button => {
  button.onclick = safe(() => activateScreen(button.dataset.tab));
});

// ---------- v2.2 voice-first planner and concise briefing ----------
// Device-local event storage; never claim notification delivery when tab is closed.
const PLAN_KEY='auren_plans_v22';
let plans=[];
try { const saved=JSON.parse(localStorage.getItem(PLAN_KEY)||'[]'); if(Array.isArray(saved)) plans=saved.filter(p=>p&&typeof p.title==='string'&&/^\d{4}-\d\d-\d\d$/.test(p.date)).slice(0,500); } catch {}
const localDate=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
$('planDate').value=localDate();
let pendingPlan=null;
let planningOffer=null;
let lastPlanningOfferAt=0;
const PLANNING_OFFER_COOLDOWN_MS=10*60*1000;
function planningOpportunity(text){
  const t=String(text||'').trim();
  if(t.length<12 || t.length>280 || /[?]$/.test(t) || /^(?:no|yes|cancel|forget|remember|schedule|add|move|delete)\b/i.test(t))return null;
  if(/\b(?:deadline|due (?:on|by|tomorrow|next)|need to finish|have to finish|a lot to do|busy (?:tomorrow|this week|next week)|falling behind)\b/i.test(t))return 'Would you like me to help you make time for that in your planner?';
  return null;
}
let lastDiscussedPlanId=null;
let reviewPending=false;
function savePlans(){ localStorage.setItem(PLAN_KEY,JSON.stringify(plans)); }
function formatClock(time){const [h,m]=time.split(':').map(Number);return new Date(2020,0,1,h,m).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});}
function plansFor(date){return plans.filter(p=>p.date===date).sort((a,b)=>a.time.localeCompare(b.time));}
function planSummary(date){const items=plansFor(date); if(!items.length)return 'You have nothing scheduled for this day. Would you like to plan something?';const names=items.slice(0,5).map(p=>`${p.title} at ${formatClock(p.time)}`).join(', ');return `You have ${items.length} ${items.length===1?'plan':'plans'}: ${names}${items.length>5?', and others':''}. ${items.length<4?'You appear to have some open time, although I cannot see your other calendars. ':''}Does that sound correct?`;}
function renderDay(){const node=$('dayTimeline');node.replaceChildren();const items=plansFor($('planDate').value);if(!items.length){node.append(el('div','day-empty','Nothing planned here yet.'));return;} for(const p of items){const item=el('div','day-item');item.append(el('span','at',formatClock(p.time)));const detail=el('div','desc',p.title);detail.append(el('small','duration',`${p.duration} minutes`));item.append(detail);const remove=el('button','remove-plan','×');remove.type='button';remove.setAttribute('aria-label',`Remove ${p.title}`);remove.onclick=async()=>{pendingPlan={kind:'delete',id:p.id};await addMessage('auren',`Shall I remove ${p.title} from your plans?`);};item.append(remove);node.append(item);}}
function openScreen(screen){ void activateScreen(screen); }
document.querySelectorAll('[data-screen]').forEach(button=>button.addEventListener('click',()=>openScreen(button.dataset.screen)));
document.querySelectorAll('.back-home').forEach(b=>b.addEventListener('click',()=>openScreen('chat')));
const projectsBack=el('button','back-home','← Home');projectsBack.type='button';projectsBack.onclick=()=>openScreen('chat');$('projects').prepend(projectsBack);
$('planDate').addEventListener('change',renderDay);
$('planForm').onsubmit=async e=>{e.preventDefault();pendingPlan={kind:'add',title:$('planTitle').value.trim(),date:$('planDate').value,time:$('planTime').value,duration:Math.max(5,Math.min(720,Number($('planDuration').value)||60))};if(pendingPlan.title&&pendingPlan.time)await addMessage('auren',`Shall I add ${pendingPlan.title} at ${formatClock(pendingPlan.time)} to your schedule?`);};
function prepareSpokenReview(){if(capabilities.speak){voice.setEnabled(true);$('speakReplies').checked=true;} if(capabilities.listen && !voice.awake)voice.startListening();voice.setReviewMode?.(true);reviewPending=true;}
function beginReview(){prepareSpokenReview();const date=$('planDate').value;addMessage('auren',planSummary(date));}
$('reviewDay').onclick=beginReview;
$('playBriefing').onclick=()=>{prepareSpokenReview();const date=localDate();addMessage('auren',`Good morning. ${planSummary(date)}`);};
function proposedDay(text){const t=text.toLowerCase(); if(/\btomorrow\b/.test(t)){const d=new Date();d.setDate(d.getDate()+1);return localDate(d);}if(/\btoday\b/.test(t))return localDate();return $('planDate').value||localDate();}
function timeFromText(text){let m=text.match(/\b(?:at|for)\s+(\d{1,2})(?::(\d\d))?\s*(am|pm)?\b/i);if(!m)return null;let h=Number(m[1]),min=Number(m[2]||0);const ap=(m[3]||'').toLowerCase();if(h>23||min>59)return null;if(ap){if(h<1||h>12)return null;h=h%12+(ap==='pm'?12:0);}else if(h>=1&&h<=7)h+=12;return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;}
function durationFromText(t){const m=t.match(/\b(\d+)\s*(hour|hours|minute|minutes)\b/i);return m?Math.min(720,Number(m[1])*(m[2].toLowerCase().startsWith('hour')?60:1)):60;}
async function planSpeech(text){const t=text.trim();
 if(planningOffer){
   if(/^(?:no|not now|maybe later|never mind|nah)\b/i.test(t)){planningOffer=null;return 'Of course. I shall leave your schedule as it is.';}
   if(/^(?:yes|yeah|sure|okay|please|let.s|sounds good)\b/i.test(t)){planningOffer=null;return 'Certainly. What would you like to make time for, and when?';}
   planningOffer=null; // unrelated conversation: don't nag or hold an offer open
 }

 if(pendingPlan && /^(yes|yeah|yep|correct|please do|do it|sure|confirm|go ahead|that's right)\b/i.test(t)){
  const p=pendingPlan;pendingPlan=null;
  if(p.kind==='add'){if(!p.title||!p.time)return 'I still need the name and time before saving that.';const event={id:uid(),title:p.title.slice(0,120),date:p.date,time:p.time,duration:p.duration||60};plans.push(event);try{savePlans();}catch(e){plans=plans.filter(x=>x.id!==event.id);return 'I could not save that event on this device.';}lastDiscussedPlanId=event.id;renderDay();return `Certainly. I have added ${event.title} at ${formatClock(event.time)}.`;}
  if(p.kind==='delete'){const old=plans.find(e=>e.id===p.id);plans=plans.filter(e=>e.id!==p.id);try{savePlans();}catch{if(old)plans.push(old);return 'I could not save that deletion.';}renderDay();return 'Certainly. I have removed that plan.';}
  if(p.kind==='move'){const event=plans.find(e=>e.id===p.id);if(!event)return 'That plan no longer exists.';const previous=event.time;event.time=p.time;try{savePlans();}catch{event.time=previous;return 'I could not save the new time.';}renderDay();return `Certainly. Moved ${event.title} to ${formatClock(event.time)}.`;}
 }
 if(pendingPlan&&/^(no|nope|cancel|don't|do not|never mind)\b/i.test(t)){pendingPlan=null;return 'Of course. I have made no changes.';}
 if(reviewPending && /^(yes|yeah|correct|sounds good|that's correct|all correct)\b/i.test(t)){reviewPending=false;voice.setReviewMode?.(false);return 'Very good. I am here if you need anything adjusted.';}
 if(/\b(?:what(?:'s| is) on|what do i have|go over|review|discuss|read|tell me about)\b.*\b(?:my day|schedule|calendar|plans|today|tomorrow)\b/i.test(t)||/^(?:my schedule|my plans)$/i.test(t)){reviewPending=true;voice.setReviewMode?.(true);return planSummary(proposedDay(t));}
 if(/^(?:wait|hold on|that's not right|that isn't right|change that|actually)\b/i.test(t)&&reviewPending){return 'Of course. What would you like me to change?';}
 const add=t.match(/^(?:please\s+)?(?:add|schedule|plan|put|book|set aside)\s+(.+)/i);
 if(add){const time=timeFromText(t);if(!time)return 'Certainly. What time should I put that on your schedule? Please include am or pm.';const title=add[1].replace(/\b(?:tomorrow|today)\b/gi,'').replace(/\b(?:at|for)\s+\d{1,2}(?::\d\d)?\s*(?:am|pm)?\b/gi,'').replace(/\b\d+\s*(?:hours?|minutes?)\b/gi,'').trim().replace(/\s+/g,' ').replace(/[.,]+$/,'');if(!title)return 'What would you like me to call that plan?';pendingPlan={kind:'add',title,date:proposedDay(t),time,duration:durationFromText(t)};return `Shall I add ${title} at ${formatClock(time)}?`;}
 if(/^(?:remove|delete|cancel)\b/i.test(t)&&/\b(?:plan|event|appointment|meeting|that|it|schedule)\b/i.test(t)){const matches=plansFor(proposedDay(t));const event=matches.find(p=>t.toLowerCase().includes(p.title.toLowerCase()))|| (matches.length===1?matches[0]:plans.find(p=>p.id===lastDiscussedPlanId));if(!event)return 'Which event would you like me to remove?';pendingPlan={kind:'delete',id:event.id};return `Shall I remove ${event.title} from your schedule?`;}
 if(/\b(?:move|change|reschedule)\b/i.test(t)&&/\b(?:to|at)\s+\d/.test(t)){const time=timeFromText(t);const candidates=plansFor(proposedDay(t));const event=candidates.find(p=>t.toLowerCase().includes(p.title.toLowerCase()))||(candidates.length===1?candidates[0]:plans.find(p=>p.id===lastDiscussedPlanId));if(!event||!time)return 'Which event and what new time would you prefer?';pendingPlan={kind:'move',id:event.id,time};return `Shall I move ${event.title} to ${formatClock(time)}?`;}
 return null;
}
// The planner only changes data after confirmation, not from arbitrary AI text.
renderDay();document.body.dataset.screen='chat';

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
    const planResponse = await planSpeech(text);
    const memoryDispute = isLocal || planResponse ? null : await memoryDisputeReply(text);
    const planningSuggestion = !isLocal && !planResponse && !memoryDispute && !pendingPlan && !planningOffer
      && Date.now()-lastPlanningOfferAt>PLANNING_OFFER_COOLDOWN_MS ? planningOpportunity(text) : null;
    if (planResponse) {
      await addMessage('auren', planResponse);
    } else if (isLocal) {
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
      if(planningSuggestion){planningOffer={prompt:planningSuggestion};lastPlanningOfferAt=Date.now();}
      await addMessage('auren', planningSuggestion ? `${answer}\n\n${planningSuggestion}` : answer);
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
