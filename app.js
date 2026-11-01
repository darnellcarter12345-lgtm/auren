// AUREN v2.9.4 — iPhone voice diagnostics and honest listening status
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
import { createVoice } from './voice.js?v=2.9.4';
import { createIPhoneRecorder } from './iphone-voice.js?v=2.9.5';
import { getAIEndpoint, setAIEndpoint, askAI } from './ai.js';
import { getWeatherBriefing } from './weather.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const butler = new Butler();
const settings = loadSettings();
const HISTORY_LIMIT = 200;
const aiRecent = [];
const aiEndpointInput = $('aiEndpoint');
window.addEventListener('auren:ai-endpoint-updated', () => { aiEndpointInput.value = getAIEndpoint(); });
aiEndpointInput.value = getAIEndpoint();
$('saveAIEndpoint').onclick = () => { try { setAIEndpoint(aiEndpointInput.value); window.dispatchEvent(new Event('auren:ai-endpoint-changed')); showStatus('AUREN AI connection saved on this browser.', 'ok'); } catch (e) { showStatus(e.message, 'error'); } };
$('clearAIEndpoint').onclick = () => { setAIEndpoint(''); aiEndpointInput.value = ''; showStatus('AI connection removed.', 'info'); };
let storageOk = false, sinceTrim = 0;
// Compact voice subtitles: fixed two lines, with older words rolling away.
// Full messages remain unchanged in Text chat and history.
const captionNode = $('liveTranscript');
let captionTimer = null;
let captionClear = null;
let captionSpeaking = false;
let lastInterimAt = 0;
function captionWords(text, count = 9) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  return words.slice(-count).join(' ');
}
function showCaption(text, speaker) {
  if (!captionNode) return;
  clearTimeout(captionClear);
  captionNode.textContent = text ? (speaker ? speaker + ': ' : '') + captionWords(text) : '';
  captionNode.parentElement?.classList.toggle('caption-visible', Boolean(text));
}
function clearCaption(delay = 1500) {
  clearTimeout(captionClear);
  captionClear = setTimeout(() => {
    if (!captionSpeaking) showCaption('', '');
  }, delay);
}
function voiceCaptionSpoken(text) {
  // voice.js invokes onSpoken both at speech start and speech end.
  if (captionSpeaking) {
    captionSpeaking = false;
    clearInterval(captionTimer);
    captionTimer = null;
    clearCaption(1400);
    // Restore the home screen to its upcoming reminder or appointment
    // once AUREN finishes a spoken reply; chat history remains intact.
    homeMessageUntil = Date.now() + 1700;
    setTimeout(() => { if (!captionSpeaking) renderUpNext(); }, 1800);
    return;
  }
  captionSpeaking = true;
  clearInterval(captionTimer);
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  let position = Math.min(words.length, 8);
  const paint = () => showCaption(words.slice(Math.max(0, position - 9), position).join(' '), 'AUREN');
  paint();
  captionTimer = setInterval(() => {
    position = Math.min(words.length, position + 2);
    paint();
    if (position >= words.length) { clearInterval(captionTimer); captionTimer = null; }
  }, 900);
}
const voice = createVoice({
  onInterim: transcript => {
    if (captionSpeaking || Date.now() - lastInterimAt < 200) return;
    lastInterimAt = Date.now();
    showCaption(transcript, 'YOU');
  },
  onSpoken: text => voiceCaptionSpoken(text),
  onTranscript: async transcript => {
    if (!captionSpeaking) { showCaption(transcript, 'YOU'); clearCaption(2500); }
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
    if (!aurenIOS) queueMicrotask(() => syncVoiceUI());
  }
});
// iPhone uses direct audio capture, not Safari SpeechRecognition.
const aurenIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const iphoneRecorder = aurenIOS ? createIPhoneRecorder({
  endpoint: getAIEndpoint,
  onStatus: (message, state) => {
    $('voiceStatus').textContent = message;
    $('heroState').textContent = message;
    $('heroState').hidden = state === 'idle';
    document.body.dataset.voiceState = state;
    if (state === 'listening') $('aurenHeadline').textContent = 'I’m listening.';
    else if (state === 'processing') $('aurenHeadline').textContent = 'One moment.';
    else if (state === 'error') $('aurenHeadline').textContent = 'Voice connection needs attention.';
    else $('aurenHeadline').textContent = 'At your service.';
  },
  onText: async transcript => {
    $('chatInput').value = transcript;
    showCaption(transcript, 'YOU');
    voice.setEnabled(true);
    $('speakReplies').checked = true;
    await send(transcript);
  }
}) : null;
async function toggleIPhoneRecorder() {
  if (!iphoneRecorder) return;
  // This function must be invoked directly by a real tap.
  if (iphoneRecorder.recording) await iphoneRecorder.stop();
  else iphoneRecorder.start();
}
function syncVoiceUI() {
  const listening = aurenIOS ? iphoneRecorder.recording : voice.listening;
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
$('micBtn').disabled = aurenIOS ? !navigator.mediaDevices?.getUserMedia : !capabilities.listen;
$('speakReplies').disabled = !capabilities.speak;
$('stopSpeech').disabled = !capabilities.speak;
$('voiceStatus').textContent = capabilities.listen ? 'Tap the orb once to activate voice. Safari may require this after each visit.' : 'Browser voice recognition unavailable. On iPhone, use the keyboard microphone in Text chat.';
$('micBtn').onclick = () => {
  if (aurenIOS) { void toggleIPhoneRecorder(); return; }
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
  // Screen navigation is always silent. Cancel any reply still playing from
  // the previous screen; never turn on TTS or the microphone from a tab click.
  if (voice.speaking) voice.stopSpeaking();
  clearInterval(captionTimer);
  captionTimer = null;
  captionSpeaking = false;
  showCaption('', '');
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
const orbButton = $('orbControl');
function activateOrb(event) {
  if (aurenIOS) { void toggleIPhoneRecorder(); return; }
  const now = Date.now();
  // Use the native click gesture, including on iPhone Safari.
  if (now - lastOrbTap < 300) return;
  lastOrbTap = now;
  if (!capabilities.listen) {
    showStatus('Voice recognition is unavailable in this browser. On iPhone, open Text chat and use the keyboard microphone to dictate.', 'error');
    return;
  }
  try {
    if (capabilities.speak) { voice.primeAudio(); voice.setEnabled(true); $('speakReplies').checked = true; }
    if (voice.speaking) {
      // Stop the reply first, then listen for the correction on this same user gesture.
      voice.stopSpeaking();
      voice.startListening();
    } else if (voice.awake && voice.microphoneActive) {
      voice.setWakeMode(true); // deliberate tap while active: return to wake-only mode
    } else {
      // Also recovers an iPhone session whose UI says awake but mic has stalled.
      voice.startListening();
    }
    syncVoiceUI();
  } catch (error) {
    showStatus('Could not activate the microphone: ' + (error?.message || 'browser permission denied'), 'error');
  }
}
// Safari needs a native user click for microphone activation; intercepting
// touchstart can prevent the standard permission flow on iPhones.
orbButton.addEventListener('click', activateOrb);
// iPhone direct recording: tap the orb or the microphone button to start;
// tap again to stop, transcribe, and receive a spoken reply.
if (aurenIOS) {
  const micHint = document.createElement('p');
  micHint.className = 'hint';
  micHint.textContent = 'iPhone: tap the orb to record, then tap again to send your voice message.';
  orbButton.insertAdjacentElement('afterend', micHint);
  $('voiceStatus').textContent = 'Ready. Tap the orb to allow microphone access and start recording.';
}

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
// Appointment dates use the user's device-local clock; never guess from the weather city.
const localTimeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'device local time';
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
function savePlans(){ localStorage.setItem(PLAN_KEY,JSON.stringify(plans)); refreshUpNext(); }
function formatClock(time){const [h,m]=time.split(':').map(Number);return new Date(2020,0,1,h,m).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});}
function plansFor(date){return plans.filter(p=>p.date===date).sort((a,b)=>a.time.localeCompare(b.time));}
const weekdayNames=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function parseISO(date){const [y,m,d]=date.split('-').map(Number);return new Date(y,m-1,d,12);}
function shiftedDate(date,days){const d=parseISO(date);d.setDate(d.getDate()+days);return localDate(d);}
function weekStart(date){const day=parseISO(date).getDay();return shiftedDate(date,-((day+6)%7));}
function weekItems(date){const start=weekStart(date),end=shiftedDate(start,6);return plans.filter(p=>p.date>=start&&p.date<=end).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));}
function readableDate(date){return parseISO(date).toLocaleDateString([], {weekday:'long',month:'short',day:'numeric'});}
// Reminder records are stored locally on this browser; timers run only with the page open.
const REMINDER_KEY='auren_reminders_v24';
let reminders=[];
try {const saved=JSON.parse(localStorage.getItem(REMINDER_KEY)||'[]');if(Array.isArray(saved)) reminders=saved.filter(r=>r&&typeof r.id==='string'&&typeof r.at==='string'&&typeof r.text==='string').slice(0,500);}catch{}
function saveReminders(){localStorage.setItem(REMINDER_KEY,JSON.stringify(reminders));}
function eventTimestamp(p){const [y,m,d]=p.date.split('-').map(Number);const [h,min]=p.time.split(':').map(Number);return new Date(y,m-1,d,h,min).getTime();}
function upcomingItems(){
 const now=Date.now();const all=[];
 for(const p of plans){const when=eventTimestamp(p);if(when>=now)all.push({when,text:p.title+' · '+readableDate(p.date)+' at '+formatClock(p.time)});}
 for(const r of reminders){const when=new Date(r.at).getTime();if(!r.fired&&Number.isFinite(when)&&when>=now)all.push({when,text:'Reminder: '+r.text+' · '+new Date(when).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'})});}
 return all.sort((a,b)=>a.when-b.when).slice(0,6);
}
let upNextIndex=0, homeMessageUntil=0;
function renderUpNext(){
 const reply=$('latestReply');if(!reply||Date.now()<homeMessageUntil)return;
 const items=upcomingItems();
 reply.textContent=items.length?items[upNextIndex%items.length].text:'Nothing coming up. Your day is clear.';
 reply.setAttribute('aria-label','Upcoming plans and reminders');
}
function refreshUpNext(){upNextIndex=0;renderUpNext();}
function checkReminders(){
 const now=Date.now();let changed=false;
 for(const r of reminders){const at=new Date(r.at).getTime();if(r.fired||!Number.isFinite(at)||at>now)continue;
 r.fired=true;changed=true;
 // Clearly mark a due reminder even if the user is in another section.
 showStatus('Reminder: '+r.text,'info');
 if(document.visibilityState==='visible'){
   homeMessageUntil=now+20000;
   $('latestReply').textContent='Reminder: '+r.text;
   // Only speak when spoken replies were enabled already; never switch on audio unexpectedly.
   if(voice.enabled&&!voice.speaking)voice.speak('A reminder: '+r.text);
 }
 }
 if(changed){try{saveReminders();}catch(e){showStatus('Reminder could not be recorded: '+e.message,'error');}}
 renderUpNext();
}
setInterval(()=>{checkReminders();upNextIndex++;renderUpNext();},12000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkReminders();});
let pendingReminder=null;
function findReminder(t){const words=t.toLowerCase();return reminders.find(r=>!r.fired&&words.includes(r.text.toLowerCase()))||null;}

// Step 3: appointments and relative reminders share a verified, device-local save path.
// Reminders can alert while AUREN is open; this does not promise background push notifications.
function reminderOffsetMinutes(text) {
 const match=String(text).match(/\b(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\s+(?:before|prior to)\b/i);
 if(!match)return null;
 const amount=Number(match[1])*(/^(?:hour|hr)/i.test(match[2])?60:1);
 return amount>0&&amount<=10080?amount:null;
}
function eventReminder(event,minutes) {
 if(!event||!Number.isFinite(minutes)||minutes<=0)return 'I need an appointment and a valid reminder interval.';
 const eventAt=eventTimestamp(event);
 const when=eventAt-minutes*60000;
 if(!Number.isFinite(when)||when<=Date.now())return `I saved ${event.title}, but the requested reminder time has already passed. Please choose another interval.`;
 const item={id:uid(),text:event.title,at:new Date(when).toISOString(),fired:false,eventId:event.id,offsetMinutes:minutes};
 reminders.push(item);
 try{saveReminders();}catch(error){reminders=reminders.filter(r=>r.id!==item.id);return `I saved ${event.title}, but couldn't save its reminder on this device.`;}
 refreshUpNext();
 return `Your reminder is saved for ${minutes} minutes before ${event.title}. It can alert you while AUREN is open.`;
}
function linkedReminderForLastEvent(text) {
 if(!/^(?:please\s+)?(?:remind me|set (?:a )?reminder|and remind me)\b/i.test(text))return null;
 if(!/\b(?:before (?:it|that|the appointment|the event)|prior to (?:it|that))\b/i.test(text))return null;
 const minutes=reminderOffsetMinutes(text);
 if(minutes===null)return 'How long before the appointment should I remind you?';
 const event=plans.find(p=>p.id===lastDiscussedPlanId);
 if(!event)return 'Which appointment should that reminder be linked to?';
 if(eventTimestamp(event)<=Date.now())return 'That appointment has already passed.';
 pendingReminder={kind:'linked',eventId:event.id,minutes};
 return `Shall I set a reminder ${minutes} minutes before ${event.title}?`;
}

function reminderSpeech(t){
 const text=t.trim();
 if(pendingReminder){
  if(/^(?:yes|yeah|yep|sure|correct|confirm|do it|please do|go ahead)\b/i.test(text)){
   const p=pendingReminder;pendingReminder=null;
   if(p.kind==='linked'){const event=plans.find(e=>e.id===p.eventId);return event?eventReminder(event,p.minutes):'That appointment no longer exists. No reminder was saved.';}
   if(p.kind==='remove'){const existing=reminders.find(r=>r.id===p.id);reminders=reminders.filter(r=>r.id!==p.id);try{saveReminders();}catch(e){if(existing)reminders.push(existing);return 'I could not save that change.';}refreshUpNext();return 'Certainly. That reminder has been removed.';}
   const item={id:uid(),text:p.text,at:p.at,fired:false};reminders.push(item);try{saveReminders();}catch(e){reminders=reminders.filter(r=>r.id!==item.id);return 'I could not save that reminder.';}refreshUpNext();return 'Certainly. I will remind you '+new Date(item.at).toLocaleString([],{weekday:'long',hour:'numeric',minute:'2-digit'})+'.';
  }
  if(/^(?:no|nope|cancel|never mind|not now)\b/i.test(text)){pendingReminder=null;return 'Very well. No reminder has been changed.';}
  // A new request cancels the old pending draft instead of hijacking it.
  if(!/^(?:remind|set a reminder|delete reminder|remove reminder|cancel reminder)\b/i.test(text))return null;
  pendingReminder=null;
 }
 if(/^(?:remove|delete|cancel)\s+(?:my\s+|the\s+|a\s+)?reminder\b/i.test(text)){
  const r=findReminder(text);if(!r)return 'Which reminder would you like me to remove?';
  pendingReminder={kind:'remove',id:r.id};return 'Shall I remove your reminder for '+r.text+'?';
 }
 if(!/^(?:please\s+)?(?:remind me|set (?:a )?reminder)\b/i.test(text))return null;
 const linked=linkedReminderForLastEvent(text);if(linked!==null)return linked;
 const before=text.match(/\b(\d{1,3})\s*(minutes?|hours?)\s+before\s+(?:my\s+|the\s+)?(.+?)(?:[.!?]|$)/i);
 if(before){
  const offset=Number(before[1])*(before[2].toLowerCase().startsWith('hour')?60:1);
  const description=before[3].trim().toLowerCase();
  const matches=plans.filter(p=>p.title.toLowerCase().includes(description)||description.includes(p.title.toLowerCase())||(/^(?:appointment|meeting|event|plan)$/.test(description)&&/^(?:appointment|meeting)$/.test(description)));
  const upcoming=matches.filter(p=>eventTimestamp(p)>Date.now()).sort((a,b)=>eventTimestamp(a)-eventTimestamp(b));
  if(upcoming.length!==1)return upcoming.length?'I found more than one matching appointment. Which date do you mean?':'I could not find that upcoming appointment in your planner. Which one did you mean?';
  const event=upcoming[0],at=new Date(eventTimestamp(event)-offset*60000);
  if(at.getTime()<=Date.now())return 'That reminder time has already passed. Would you prefer a different time?';
  pendingReminder={kind:'add',text:event.title,at:at.toISOString()};
  return 'Shall I remind you about '+event.title+' '+offset+' minutes beforehand?';
 }
 const direct=text.match(/\b(?:tomorrow|today|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i);
 const time=text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
 if(!direct||!time)return 'Certainly. Please tell me what to remind you about, with a day and time, such as “remind me tomorrow at 3 PM to call Alex.”';
 const day=parseDateIntent(text),clock=timeFromText('at '+time[1]+(time[2]?':'+time[2]:'')+' '+time[3]);
 if(!day||!clock||clock==='ambiguous')return 'Which day and time would you prefer?';
 const [y,m,d]=day.split('-').map(Number),[h,min]=clock.split(':').map(Number);const when=new Date(y,m-1,d,h,min);
 if(when.getTime()<=Date.now())return 'That time has already passed. Please choose a future time.';
 const subject=text.replace(/^(?:please\s+)?(?:remind me|set (?:a )?reminder)\s*/i,'').replace(/\b(?:today|tomorrow|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi,'').replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi,'').replace(/^(?:to|about)\s+/i,'').trim();
 if(!subject)return 'What would you like me to remind you about?';
 pendingReminder={kind:'add',text:subject,at:when.toISOString()};
 return 'Shall I remind you to '+subject+' '+when.toLocaleString([],{weekday:'long',hour:'numeric',minute:'2-digit'})+'?';
}
let plannerScope='day', briefingScope='day';
function setScopeButtons(ids,selected){for(const [scope,id] of Object.entries(ids)){const b=$(id);b.classList.toggle('scope-active',scope===selected);b.setAttribute('aria-pressed',String(scope===selected));}}
function setPlannerScope(scope){plannerScope=scope;setScopeButtons({day:'viewDay',week:'viewWeek'},scope);$('plannerHeading').textContent=scope==='week'?'Your Week':'Your Day';renderDay();}
function setBriefingScope(scope){briefingScope=scope;setScopeButtons({day:'briefDay',week:'briefWeek'},scope);$('briefingScopeLabel').textContent=scope==='week'?'Your week’s plans':'Today’s plans';}
$('viewDay').onclick=()=>setPlannerScope('day');$('viewWeek').onclick=()=>setPlannerScope('week');
$('briefDay').onclick=()=>setBriefingScope('day');$('briefWeek').onclick=()=>setBriefingScope('week');
const weatherCityField=document.createElement('input');weatherCityField.id='weatherCity';weatherCityField.type='text';weatherCityField.maxLength=80;weatherCityField.setAttribute('aria-label','Weather city');weatherCityField.placeholder='Weather city';weatherCityField.value=localStorage.getItem('auren_weather_city')||'Dallas';const weatherCityWrap=document.createElement('label');weatherCityWrap.className='hint';weatherCityWrap.textContent='Weather city ';weatherCityWrap.append(weatherCityField);$('settings').append(weatherCityWrap);
$('weatherCity').addEventListener('change',()=>{const city=$('weatherCity').value.trim().slice(0,80); if(city){localStorage.setItem('auren_weather_city',city); $('weatherCity').value=city;}});
function weekSummary(date){
 const items=weekItems(date);
 if(!items.length)return 'There are no plans saved for this week. That is only what is in this planner.';
 const groups=new Map();for(const p of items){const name=weekdayNames[parseISO(p.date).getDay()];if(!groups.has(name))groups.set(name,[]);groups.get(name).push(`${p.title} at ${formatClock(p.time)}`);}
 const spoken=[...groups].map(([day,entries])=>`${day}: ${entries.slice(0,3).join(', ')}${entries.length>3?', and more':''}`).join('. ');
 return `This week you have ${items.length} ${items.length===1?'plan':'plans'}. ${spoken}. Does that sound correct?`;
}
function requestedScope(t){return /\b(?:this week|next week|my week|the week|weekly|whole week)\b/i.test(t)?'week':'day';}
function weekOrDaySummary(date,scope){return scope==='week'?weekSummary(date):planSummary(date);}
function extractWeekdayDate(t,baseDate=localDate()){
 const lower=t.toLowerCase();const found=lower.match(/\b(?:(next|this|on)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
 if(!found)return null;
 const names=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];const day=names.indexOf(found[2]);
 const base=parseISO(baseDate);const delta=(day-base.getDay()+7)%7;
 // "next Monday" means the Monday of next week, rather than an ambiguous day within this week.
 if(found[1]==='next'){const start=weekStart(baseDate);return shiftedDate(start,7+(day+6)%7);}
 if(found[1]==='this'){return shiftedDate(weekStart(baseDate),(day+6)%7);}
 return shiftedDate(baseDate,delta);
}
function parseDateIntent(t){
 const lower=t.toLowerCase();if(/\bday after tomorrow\b/.test(lower))return shiftedDate(localDate(),2);
 if(/\btomorrow\b/.test(lower))return shiftedDate(localDate(),1);
 if(/\btoday\b/.test(lower))return localDate();
 const day=extractWeekdayDate(t);if(day)return day;
 if(/\bnext week\b/.test(lower))return shiftedDate(weekStart(localDate()),7);
 if(/\bthis week\b/.test(lower))return weekStart(localDate());
 return null;
}
function findMatchingEvent(t){
 const candidates=plans.filter(p=>t.toLowerCase().includes(p.title.toLowerCase()));
 if(candidates.length===1)return candidates[0];if(candidates.length>1)return null;
 const current=plansFor($('planDate').value);if(current.length===1)return current[0];
 return plans.find(p=>p.id===lastDiscussedPlanId)||null;
}
// v2.3: find overlap by actual time intervals; all times are device-local.
function minutesOf(time){const [h,m]=String(time).split(':').map(Number);return h*60+m;}
function endOf(p){return minutesOf(p.time)+Math.max(1,Number(p.duration)||60);}
function overlaps(a,b){return a.date===b.date&&minutesOf(a.time)<endOf(b)&&minutesOf(b.time)<endOf(a);}
function conflictingEvents(candidate,excludeId=null){return plans.filter(p=>p.id!==excludeId&&overlaps(candidate,p));}
function nextAvailable(candidate,excludeId=null){
 let start=minutesOf(candidate.time),duration=Math.max(1,Number(candidate.duration)||60);
 while(start+duration<=24*60){
  const probe={...candidate,time:`${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')}`};
  const conflicts=conflictingEvents(probe,excludeId);
  if(!conflicts.length)return probe.time;
  start=Math.max(start+5,...conflicts.map(endOf));
  start=Math.ceil(start/5)*5;
 }
 return null;
}
function conflictAdvice(p){
 const conflicts=conflictingEvents(p,p.kind==='move'?p.id:null);
 if(!conflicts.length)return null;
 const suggestion=nextAvailable(p,p.kind==='move'?p.id:null);
 p.conflictAcknowledged=false;
 p.suggestedTime=suggestion;
 return `That overlaps with ${conflicts.slice(0,2).map(c=>`${c.title} at ${formatClock(c.time)}`).join(' and ')}. ${suggestion?`${formatClock(suggestion)} is available. Shall I use that instead?`:'I cannot find a free opening later that day. Would you prefer a different day?'} `;
}
function changeDescription(p){const name=p.title||plans.find(e=>e.id===p.id)?.title||'that plan';return `${p.kind==='add'?'add':p.kind==='move'?'move':'remove'} ${name}${p.kind==='delete'?'':` on ${readableDate(p.date)} at ${formatClock(p.time)}`}`;}
let planClarification=null;
function extractLooseTime(t){const m=String(t).match(/^(?:at\s+|to\s+|make\s+(?:it|that)\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);return m?timeFromText('at '+m[0].replace(/^(?:at|to|make (?:it|that))\s+/i,'')):timeFromText(t);}
function durationMention(t){return /\b\d+\s*(?:hours?|minutes?)\b/i.test(t);}
function planSummary(date){const items=plansFor(date); if(!items.length)return 'You have nothing scheduled for this day.';const names=items.slice(0,5).map(p=>`${p.title} at ${formatClock(p.time)}`).join(', ');return `You have ${items.length} ${items.length===1?'plan':'plans'}: ${names}${items.length>5?', and others':''}. Does that sound correct?`;}
function renderDay(){
 const node=$('dayTimeline');
 node.replaceChildren();
 const items=plannerScope==='week'?weekItems($('planDate').value):plansFor($('planDate').value);
 // Voice-first: show only appointments saved for this date, never empty clock rows.
 if(!items.length){
  node.append(el('div','day-empty',plannerScope==='week'?'Nothing scheduled this week.':'Nothing scheduled.'));
  return;
 }
 for(const p of items){
  const card=el('div','day-event');
  const label=el('div','day-event-clock',(plannerScope==='week'?weekdayNames[parseISO(p.date).getDay()].slice(0,3)+' · ':'')+formatClock(p.time));
  const content=el('div','day-event-content');
  content.append(el('div','day-event-title',p.title));
  const remove=el('button','remove-plan','×');
  remove.type='button';
  remove.setAttribute('aria-label',`Remove ${p.title}`);
  remove.onclick=()=>{
   // Manually deleting a plan is a direct UI action, never a voice conversation.
   const previousPlans=[...plans];
   const previousReminders=[...reminders];
   plans=plans.filter(item=>item.id!==p.id);
   reminders=reminders.filter(item=>item.eventId!==p.id);
   try{
    savePlans();
    saveReminders();
    pendingPlan=null;
    if(lastDiscussedPlanId===p.id)lastDiscussedPlanId=null;
    renderDay();
    showStatus('Appointment removed.', 'ok');
   }catch(error){
    plans=previousPlans;
    reminders=previousReminders;
    try{savePlans();saveReminders();}catch{}
    renderDay();
    showStatus('Could not remove appointment: '+(error?.message||'storage unavailable'), 'error');
   }
  };
  card.append(label,content,remove);
  node.append(card);
 }
}
function openScreen(screen){ void activateScreen(screen); }
// Navigation must never start speech or the microphone automatically.
// Spoken replies are reserved for questions, planner confirmations and an explicitly played briefing.
document.querySelectorAll('[data-screen]').forEach(button=>button.addEventListener('click',()=>{
  openScreen(button.dataset.screen);
}));
document.querySelectorAll('.back-home').forEach(b=>b.addEventListener('click',()=>openScreen('chat')));
const projectsBack=el('button','back-home','← Home');projectsBack.type='button';projectsBack.onclick=()=>openScreen('chat');$('projects').prepend(projectsBack);
$('planDate').addEventListener('change',renderDay);
$('planForm').onsubmit=e=>{
  e.preventDefault();
  const title=$('planTitle').value.trim();
  const date=$('planDate').value;
  const time=$('planTime').value;
  if(!title||!date||!time){
    showStatus('Please enter an appointment name, date and time.', 'error');
    return;
  }
  // Manual planner saves directly and silently. Voice-driven scheduling is
  // handled separately by the conversation planner, with no interference.
  const event={id:uid(),title:title.slice(0,120),date,time,duration:60};
  plans.push(event);
  try{
    savePlans();
    pendingPlan=null;
    $('planTitle').value='';
    renderDay();
    showStatus('Appointment saved.', 'ok');
  }catch(error){
    plans=plans.filter(item=>item.id!==event.id);
    showStatus('Could not save appointment: '+(error?.message||'storage unavailable'), 'error');
  }
};
function prepareSpokenReview(){
  // A briefing click requests a spoken briefing; it must not open a second
  // microphone session at the same time (especially unreliable on iPhone).
  if(capabilities.speak){voice.setEnabled(true);$('speakReplies').checked=true;}
  voice.setReviewMode?.(true);
  reviewPending=true;
}
function beginReview(){prepareSpokenReview();const date=$('planDate').value;addMessage('auren',planSummary(date));}
// Spoken review remains available through the daily briefing and natural conversation.
$('playBriefing').onclick=async()=>{
  // Prime speech during the click, BEFORE any asynchronous weather request.
  voice.primeAudio();
  prepareSpokenReview();
  const date=localDate();
  const summary=weekOrDaySummary(date,briefingScope);
  const today=new Date();
  const end=briefingScope==='week'?new Date(today.getTime()+7*86400000):new Date(today.getFullYear(),today.getMonth(),today.getDate()+1);
  const due=reminders.filter(r=>!r.fired&&new Date(r.at)>=today&&new Date(r.at)<end).sort((a,b)=>a.at.localeCompare(b.at));
  const extra=due.length?' You also have '+due.length+' upcoming '+(due.length===1?'reminder':'reminders')+'.':'';
  const city=localStorage.getItem('auren_weather_city')||'Dallas';
  // Some deployed layouts omit this optional weather status node.
  // Never let a missing DOM element break the spoken briefing.
  const weatherStatus=$('briefingWeatherStatus');
  if(weatherStatus)weatherStatus.textContent='Checking weather for '+city+'…';
  let result;
  try { result=await getWeatherBriefing(city,briefingScope); }
  catch(error) { console.warn('Weather briefing unavailable:',error); result={success:false}; }
  if(weatherStatus)weatherStatus.textContent=result?.success?'Weather: '+result.display:'Weather unavailable — schedule still works.';
  const weather=result?.success?' '+result.spoken:'';
  await addMessage('auren',`Good morning. ${summary}${extra}${weather}`);
};
function proposedDay(text){return parseDateIntent(text)||$('planDate').value||localDate();}
function timeFromText(text){
 const m=text.match(/\b(?:at|to|for)\s+(\d{1,2})(?::(\d\d))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
 if(!m)return null;let h=Number(m[1]),minute=Number(m[2]||0),ampm=(m[3]||'').replaceAll('.','').toLowerCase();
 if(minute>59||h>23)return null;
 if(!ampm && h<=12)return 'ambiguous';
 if(ampm){if(h<1||h>12)return null;h=h%12+(ampm==='pm'?12:0);}
 return `${String(h).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
}
function durationFromText(t){const m=t.match(/\b(\d+)\s*(hour|hours|minute|minutes)\b/i);return m?Math.min(720,Number(m[1])*(m[2].toLowerCase().startsWith('hour')?60:1)):60;}
async function planSpeech(text){const t=text.trim();
 if(planningOffer){
   if(/^(?:no|not now|maybe later|never mind|nah)\b/i.test(t)){planningOffer=null;return 'Of course. I shall leave your schedule as it is.';}
   if(/^(?:yes|yeah|sure|okay|please|let.s|sounds good)\b/i.test(t)){planningOffer=null;return 'Certainly. What would you like to make time for, and when?';}
   planningOffer=null; // unrelated conversation: don't nag or hold an offer open
 }

 if(planClarification){
  const previous=planClarification;
  if(/^(?:cancel|nevermind|never mind|no thanks)\b/i.test(t)){planClarification=null;return 'Of course. No changes made.';}
  if(previous.kind==='move-when'){
    const day=parseDateIntent(t),at=extractLooseTime(t);
    if(at==='ambiguous')return 'Would that be AM or PM?';
    if(day || at){
      planClarification=null;
      pendingPlan={...previous.plan,date:day||previous.plan.date,time:at||previous.plan.time};
      const conflict=conflictAdvice(pendingPlan);
      return conflict||`Shall I move ${previous.plan.title} to ${readableDate(pendingPlan.date)} at ${formatClock(pendingPlan.time)}?`;
    }
    if(/\b(?:what day|which appointment|which event)\b/i.test(t))return `We're changing ${previous.plan.title}, currently on ${readableDate(previous.plan.date)} at ${formatClock(previous.plan.time)}. What new day or time would you like?`;
    if(!/^(?:schedule|add|move|change|remove|delete)\b/i.test(t))return `What new day or time would you like for ${previous.plan.title}?`;
    planClarification=null;
  }
  if(previous.kind==='time'){
    const given=extractLooseTime(t);
    if(given==='ambiguous')return 'Was that AM or PM?';
    if(given){planClarification=null;pendingPlan={...previous.plan,time:given};const conflict=conflictAdvice(pendingPlan);return conflict||`Shall I ${changeDescription(pendingPlan)}?`;}
  }
  if(previous.kind==='which'){
    const match=findMatchingEvent(t);
    if(match){planClarification=null;pendingPlan={...previous.plan,id:match.id,title:match.title,date:previous.plan.date||match.date,time:previous.plan.time||match.time,duration:match.duration};const conflict=previous.plan.kind==='move'?conflictAdvice(pendingPlan):null;return conflict||`Shall I ${changeDescription(pendingPlan)}?`;}
  }
  // Clear the old clarification if user begins a new instruction.
  if(/^(?:schedule|add|move|change|remove|delete|what|discuss)\b/i.test(t))planClarification=null;
  else return previous.kind==='which'?'Which event do you mean?':'Please tell me the time, including AM or PM.';
 }
 // A single accepted suggested slot is a completed confirmation, not a fresh prompt.
 if(pendingPlan && pendingPlan.suggestedTime && !pendingPlan.conflictAcknowledged){
  if(/^(?:yes|yeah|yep|sure|okay|ok|use that|that works|please do|go ahead|do it|sounds good|confirm)\b/i.test(t)){
    pendingPlan.time=pendingPlan.suggestedTime;
    pendingPlan.suggestedTime=null;
    pendingPlan.conflictAcknowledged=true;
    // Continue into the confirmation handler below.
  }else if(/^(?:no|nope|cancel|never mind|forget it|leave it)\b/i.test(t)){
    pendingPlan=null;return 'Of course. Nothing has been changed.';
  }else if(/^(?:keep|use original|anyway|overlap)\b/i.test(t)){
    pendingPlan.suggestedTime=null;
    pendingPlan.conflictAcknowledged=true;
    return `That overlaps an existing appointment. Shall I ${changeDescription(pendingPlan)} anyway?`;
  }else{
    const date=parseDateIntent(t);
    const alternate=extractLooseTime(t);
    if(date || (alternate && alternate!=='ambiguous')){
      if(date)pendingPlan.date=date;
      if(alternate && alternate!=='ambiguous')pendingPlan.time=alternate;
      pendingPlan.suggestedTime=null;
      const conflict=conflictAdvice(pendingPlan);
      return conflict||`Certainly. Shall I ${changeDescription(pendingPlan)}?`;
    }
    if(/\b(?:what day|which day|what date|which date|when is that|what time|which time)\b/i.test(t)){
      return `The suggested opening is ${readableDate(pendingPlan.date)} at ${formatClock(pendingPlan.suggestedTime)}. Would you like me to use it?`;
    }
    return 'You can accept that opening, tell me another day or time, or leave the appointment unchanged.';
  }
 }
 // Keep a rescheduling conversation anchored to the selected appointment.
 if(pendingPlan && pendingPlan.kind==='move' && !pendingPlan.suggestedTime){
  if(/\b(?:what day|which day|what date|which date|what time|when is (?:it|that)|what are we moving)\b/i.test(t)){
    const original=plans.find(p=>p.id===pendingPlan.id);
    return `We're moving ${original?.title||'the appointment'} from ${original?readableDate(original.date):'its original date'} to ${readableDate(pendingPlan.date)} at ${formatClock(pendingPlan.time)}. Is that right?`;
  }
  const dateOnly=parseDateIntent(t);
  const timeOnly=extractLooseTime(t);
  const isRevision=/^(?:actually|instead|rather|no[,]? (?:make|move|try)|how about|what about|could we|can we|let.s|tomorrow|today|(?:on )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(t);
  if((dateOnly||timeOnly&&timeOnly!=='ambiguous') && isRevision){
    if(dateOnly)pendingPlan.date=dateOnly;
    if(timeOnly && timeOnly!=='ambiguous')pendingPlan.time=timeOnly;
    const conflict=conflictAdvice(pendingPlan);
    return conflict||`Certainly. Shall I move it to ${readableDate(pendingPlan.date)} at ${formatClock(pendingPlan.time)}?`;
  }
 }
 if(pendingPlan && /^(yes|yeah|yep|okay|ok|that works|sounds good|correct|please do|do it|sure|confirm|go ahead|that's right)\b/i.test(t)){
  const p=pendingPlan;
  const combinedReminder=/\bremind\s+me\b/i.test(t)?reminderOffsetMinutes(t):null;
  if(p.kind!=='delete'&&!p.conflictAcknowledged){const latest=conflictingEvents(p,p.kind==='move'?p.id:null);if(latest.length){const prompt=conflictAdvice(p);return prompt||'That time now conflicts with another event.';}}
  pendingPlan=null;
  if(p.kind==='add'){if(!p.title||!p.time)return 'I still need the name and time before saving that.';const event={id:uid(),title:p.title.slice(0,120),date:p.date,time:p.time,duration:p.duration||60};plans.push(event);try{savePlans();}catch(e){plans=plans.filter(x=>x.id!==event.id);return 'I could not save that event on this device.';}lastDiscussedPlanId=event.id;renderDay();const saved=`I've added ${event.title} for ${readableDate(event.date)} at ${formatClock(event.time)} (${localTimeZone()}).`;return combinedReminder!==null?saved+' '+eventReminder(event,combinedReminder):saved;}
  if(p.kind==='delete'){const old=plans.find(e=>e.id===p.id);plans=plans.filter(e=>e.id!==p.id);try{savePlans();}catch{if(old)plans.push(old);return 'I could not save that deletion.';}const linked=reminders.filter(r=>r.eventId===p.id);if(linked.length){const backup=[...reminders];reminders=reminders.filter(r=>r.eventId!==p.id);try{saveReminders();}catch{reminders=backup;return 'The appointment was deleted, but its linked reminders could not be removed. Please check your reminders.';}}renderDay();return 'I removed that appointment'+(linked.length?' and its linked reminders.':'.');}
  if(p.kind==='move'){const event=plans.find(e=>e.id===p.id);if(!event)return 'That plan no longer exists.';const previous={time:event.time,date:event.date,duration:event.duration};event.time=p.time||event.time;event.date=p.date||event.date;event.duration=p.duration||event.duration;try{savePlans();}catch{Object.assign(event,previous);return 'I could not save that change.';}lastDiscussedPlanId=event.id;$('planDate').value=event.date;renderDay();
   const linked=reminders.filter(r=>!r.fired&&r.eventId===event.id&&Number.isFinite(r.offsetMinutes));
   if(linked.length){const original=linked.map(r=>({r,at:r.at}));for(const r of linked){const next=eventTimestamp(event)-r.offsetMinutes*60000;if(next>Date.now())r.at=new Date(next).toISOString();else r.fired=true;}try{saveReminders();}catch(error){original.forEach(({r,at})=>r.at=at);return `Moved ${event.title}, but I couldn't update its linked reminders. Please check them.`;}}
   return `Moved ${event.title} to ${formatClock(event.time)} on ${readableDate(event.date)}.${linked.length?' Its linked reminders were updated.':''}`;}
 }
 if(pendingPlan&&/^(no|nope|cancel|don't|do not|never mind)\b/i.test(t)){pendingPlan=null;return 'Of course. I have made no changes.';}
 if(pendingPlan && /^(?:actually|wait|instead|make (?:it|that)|change (?:it|that))\b/i.test(t)){
  const date=parseDateIntent(t),time=timeFromText(t);if(time==='ambiguous')return 'Did you mean AM or PM?';
  if(date)pendingPlan.date=date;if(time)pendingPlan.time=time;if(durationMention(t))pendingPlan.duration=durationFromText(t);
  const conflict=pendingPlan.kind==='delete'?null:conflictAdvice(pendingPlan);return conflict||`Understood. Shall I ${changeDescription(pendingPlan)}?`;
 }

 if(reviewPending && /^(yes|yeah|correct|sounds good|that's correct|all correct)\b/i.test(t)){reviewPending=false;voice.setReviewMode?.(false);return 'Very good. I am here if you need anything adjusted.';}
 if(/\b(?:what(?:'s| is) on|what do i have|go over|review|discuss|read|tell me about|brief(?:ing)?)\b.*\b(?:my day|my week|this week|next week|schedule|calendar|plans|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(t)||/^(?:my schedule|my plans|my week)$/i.test(t)){reviewPending=true;voice.setReviewMode?.(true);const scope=requestedScope(t);const date=proposedDay(t);if(scope==='week'||parseDateIntent(t)){$('planDate').value=date;setPlannerScope(scope);}return weekOrDaySummary(date,scope);}
 if(/^(?:wait|hold on|that's not right|that isn't right|change that|actually)\b/i.test(t)&&reviewPending){return 'Of course. What would you like me to change?';}
 const add=t.match(/^(?:please\s+)?(?:add|schedule|plan|put|book|set aside|set up|create|set)\s+(?:(?:me|us)\s+)?(?:(?:a|an)\s+)?(.+)/i);
 if(add){const time=timeFromText(t);if(time==='ambiguous'||!time){const title=add[1].replace(/\b(?:at|for)\s+\d{1,2}(?::\d\d)?\s*(?:am|pm)?\b/gi,'').replace(/\b(?:today|tomorrow|on|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi,'').trim();planClarification={kind:'time',plan:{kind:'add',title:title||'Untitled plan',date:proposedDay(t),duration:durationFromText(t)}};return time==='ambiguous'?'Would that be AM or PM? Please give the time again.':'What time would you like, including AM or PM?';}const title=add[1].replace(/\b(?:tomorrow|today|day after tomorrow|next week|this week|(?:next|this|on)?\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi,'').replace(/\b(?:at|for)\s+\d{1,2}(?::\d\d)?\s*(?:am|pm)?\b/gi,'').replace(/\b\d+\s*(?:hours?|minutes?)\b/gi,'').trim().replace(/\s+/g,' ').replace(/[.,]+$/,'');if(!title)return 'What would you like me to call that plan?';pendingPlan={kind:'add',title,date:proposedDay(t),time,duration:durationFromText(t)};return conflictAdvice(pendingPlan)||`Shall I add ${title} on ${readableDate(pendingPlan.date)} at ${formatClock(time)} (${localTimeZone()})?`;}
 if(/^(?:remove|delete|cancel)\b/i.test(t)&&/\b(?:plan|event|appointment|meeting|that|it|schedule)\b/i.test(t)){const event=findMatchingEvent(t);if(!event)return 'Which event would you like me to remove?';pendingPlan={kind:'delete',id:event.id};return `Shall I remove ${event.title} from your schedule?`;}
 if(/^(?:make (?:that|it)|change (?:that|it) to|actually make (?:that|it))\b/i.test(t)&&lastDiscussedPlanId&&!pendingPlan){
  const event=plans.find(p=>p.id===lastDiscussedPlanId);
  if(event){const time=extractLooseTime(t),date=parseDateIntent(t),hasDuration=durationMention(t);
   if(time==='ambiguous')return 'Did you mean AM or PM?';
   if(time||date||hasDuration){pendingPlan={kind:'move',id:event.id,time:time||event.time,date:date||event.date,duration:hasDuration?durationFromText(t):event.duration};return conflictAdvice(pendingPlan)||`Shall I update ${event.title}${hasDuration?' to '+pendingPlan.duration+' minutes':''}${time?' at '+formatClock(time):''}?`;}
  }
 }
 if(/\b(?:move|change|reschedule)\b/i.test(t)){const time=timeFromText(t);const event=findMatchingEvent(t);if(!event)return 'Which event would you like me to change?';if(time==='ambiguous')return 'Did you mean AM or PM? Please include that when giving the new time.';const explicitDate=!!parseDateIntent(t);if(!time&&!explicitDate){planClarification={kind:'move-when',plan:{kind:'move',id:event.id,title:event.title,date:event.date,time:event.time,duration:event.duration}};lastDiscussedPlanId=event.id;return `Certainly. Which day or time should I move ${event.title} to?`;}pendingPlan={kind:'move',id:event.id,time:time||event.time,date:explicitDate?proposedDay(t):event.date,duration:/\b\d+\s*(?:hours?|minutes?)\b/i.test(t)?durationFromText(t):event.duration};lastDiscussedPlanId=event.id;return conflictAdvice(pendingPlan)||`Shall I move ${event.title} to ${formatClock(pendingPlan.time)} on ${readableDate(pendingPlan.date)}?`;}
 return null;
}
// The planner only changes data after confirmation, not from arbitrary AI text.
renderDay();document.body.dataset.screen='chat';refreshUpNext();checkReminders();

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
  if (rec.role === 'auren') { homeMessageUntil=Date.now()+16000; $('latestReply').textContent = rec.text; }
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

// ---------- v2.6 Advanced Butler Intelligence (device-local, zero extra AI calls) ----------
const BUTLER_PREF_KEY = 'auren_butler_preferences_v26';
let butlerPreferences = { preferredWindow: 'any', suggestions: true };
try {
  const saved = JSON.parse(localStorage.getItem(BUTLER_PREF_KEY) || '{}');
  if (['morning', 'afternoon', 'evening', 'any'].includes(saved.preferredWindow)) butlerPreferences.preferredWindow = saved.preferredWindow;
  if (typeof saved.suggestions === 'boolean') butlerPreferences.suggestions = saved.suggestions;
} catch { /* Keep defaults; never delete saved data. */ }
function saveButlerPreferences() {
  try { localStorage.setItem(BUTLER_PREF_KEY, JSON.stringify(butlerPreferences)); }
  catch (error) { showStatus('Butler preference could not be saved: '+error.message, 'error'); }
}
function smartButlerReply(utterance) {
  const t = String(utterance || '').trim().toLowerCase();
  if (/\b(?:stop (?:suggesting|making suggestions)|no (?:more )?suggestions|don't suggest|do not suggest)\b/.test(t)) {
    butlerPreferences.suggestions = false; saveButlerPreferences();
    return 'Certainly. I will stop offering unsolicited planning suggestions. You can still ask for advice whenever you wish.';
  }
  if (/\b(?:start suggesting|enable suggestions|suggestions on|offer suggestions again)\b/.test(t)) {
    butlerPreferences.suggestions = true; saveButlerPreferences();
    return 'Certainly. I will offer occasional planning suggestions when they seem useful.';
  }
  const preference = t.match(/\b(?:i (?:usually )?prefer|schedule (?:my )?(?:plans|appointments|meetings) (?:in|for)|my preferred time is)\s+(?:the\s+)?(morning|afternoon|evening)s?\b/);
  if (preference && !/\b(?:don't|do not|never)\b/.test(t)) {
    butlerPreferences.preferredWindow = preference[1]; saveButlerPreferences();
    return `Understood. I'll favour ${preference[1]} openings when suggesting times. You can change that preference whenever you like.`;
  }
  if (/\b(?:no time preference|any time is fine|no preferred time|clear (?:my )?time preference)\b/.test(t)) {
    butlerPreferences.preferredWindow = 'any'; saveButlerPreferences();
    return 'Certainly. I will consider all daytime openings equally.';
  }
  if (/\b(?:what (?:are|is) my (?:scheduling|planning|time) preferences|when do i prefer to schedule|are suggestions (?:on|off))\b/.test(t)) {
    return `Your preferred scheduling period is ${butlerPreferences.preferredWindow === 'any' ? 'not set' : butlerPreferences.preferredWindow}. Planning suggestions are ${butlerPreferences.suggestions ? 'on' : 'off'}. These preferences are saved on this device.`;
  }
  const askingConflicts = /\b(?:do i have|are there|check|find|show|any)\b.*\b(?:conflicts|overlaps|double.bookings)\b|\b(?:conflicts|overlaps|double.bookings)\b.*\b(?:schedule|planner|appointments)\b/.test(t);
  const askingBusy = /\b(?:busiest day|most busy day|which day (?:am i|is) busiest)\b/.test(t);
  const askingFree = /\b(?:when (?:am i|will i be) free|free time|free slot|available (?:time|times|slots)|when can i (?:fit|schedule)|find (?:me )?(?:an? )?(?:opening|slot))\b/.test(t);
  if (!askingConflicts && !askingBusy && !askingFree) return null;
  const scopeDate = parseDateIntent(t) || localDate();
  const isWeek = askingBusy || /\b(?:week|weekly)\b/.test(t);
  const items = isWeek ? weekItems(scopeDate) : plansFor(scopeDate);
  if (askingBusy) {
    const week = weekItems(scopeDate), totals = new Map();
    for (const p of week) totals.set(p.date, (totals.get(p.date) || 0) + Math.max(1, Number(p.duration) || 60));
    if (!totals.size) return 'There are no plans in your planner this week, so I cannot identify a busiest day.';
    const peak = Math.max(...totals.values());
    const days = [...totals].filter(([,minutes])=>minutes===peak).map(([day])=>readableDate(day));
    return `${days.length>1?'Your busiest days are':'Your busiest day is'} ${days.join(' and ')}, with ${Math.round(peak / 60 * 10) / 10} hours scheduled. This is based only on plans saved in AUREN.`;
  }
  if (askingConflicts) {
    const pairs=[];
    for (let i=0;i<items.length;i++) for (let j=i+1;j<items.length;j++) {
      if (overlaps(items[i],items[j])) pairs.push(`${items[i].title} and ${items[j].title} on ${readableDate(items[i].date)}`);
    }
    return pairs.length ? `I found ${pairs.length} overlap${pairs.length===1?'':'s'}: ${pairs.slice(0,3).join('; ')}${pairs.length>3?'; and others':''}. Would you like help moving an appointment?` : `I found no overlapping appointments ${isWeek?'this week':'on '+readableDate(scopeDate)} in your saved planner.`;
  }
  // Choose a free opening for a one-hour activity, using local saved appointments only.
  const window = butlerPreferences.preferredWindow;
  const limits = window === 'morning' ? [8*60,12*60] : window === 'afternoon' ? [12*60,17*60] : window === 'evening' ? [17*60,21*60] : [9*60,20*60];
  const date = scopeDate;
  const today = date === localDate();
  let start = limits[0];
  if (today) {const now = new Date(); start = Math.max(start, Math.ceil((now.getHours()*60+now.getMinutes()+15)/15)*15);}
  const occupied = plansFor(date);
  while (start + 60 <= limits[1]) {
    const candidate={date,time:`${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')}`,duration:60};
    if (!occupied.some(event=>overlaps(candidate,event))) return `You have a one-hour opening on ${readableDate(date)} at ${formatClock(candidate.time)}, based on your saved plans. Shall I help you schedule something there?`;
    start += 15;
  }
  return `I couldn't find a full free hour ${window==='any'?'between 9 AM and 8 PM':'in your preferred '+window+' hours'} on ${readableDate(date)}. Would you like to try a different day?`;
}

let recentWeatherScope = null;
let recentWeatherAt = 0;
let recentWeatherHour = null;
async function send(text) {
  // Preserve the user's Read replies aloud preference. Text messages must not
  // turn speech on automatically or override the user's explicit setting.
  // Voice initiated from the orb still enables speech in the orb handler.
  await addMessage('user', text, { ephemeral: isSessionNote(text) });
  try {
    // Explicit preferences and schedule insights are device-local, and never consume AI credits.
    // Do not intercept replies to a pending confirmation or reminder.
    if (!pendingPlan && !pendingReminder && !planClarification) {
      const butlerReply = smartButlerReply(text);
      if (butlerReply !== null) { await addMessage('auren', butlerReply); return; }
    }
    // Weather intelligence: answer from the free hourly forecast, not a canned AI reply.
    // Follow-ups are scoped to the last weather conversation for a short time.
    const cleaned = text.trim();
    const weatherFresh = recentWeatherScope && Date.now() - recentWeatherAt < 120000;
    const explicitWeather = /\b(weather|forecast|temperature|raining|rain|snow|snowing|degrees|windy|wind|humidity|humid|precipitation|uv index|sun exposure)\b/i.test(cleaned);
    const contextualWeather = weatherFresh && /^(?:what about|how about|and |at |around |is it|will it|would it|tell me more|more details|go into|explain|what if|what's it like|can i|could i)\b/i.test(cleaned);
    const otherAction = /^(?:please\s+)?(?:remind|schedule|plan|add|move|reschedule|change|delete|remove|remember|forget|set\s+(?:a\s+)?(?:reminder|appointment|event|bike ride)|set up|create)\b/i.test(cleaned);
    if ((explicitWeather || contextualWeather) && !otherAction) {
      const city = localStorage.getItem('auren_weather_city') || 'Dallas';
      const scope = /\btomorrow\b/i.test(cleaned) ? 'tomorrow'
        : /\b(week|weekly|next\s+7\s+days|seven\s+days)\b/i.test(cleaned) ? 'week'
        : (weatherFresh ? recentWeatherScope : 'day');
      // A short question such as 'what about the wind?' inherits the last forecast day.
      // 'What about 4 PM?' inherits the topic, but not an imaginary AM/PM value.
      const hourText = cleaned.match(/\b(?:at|around|about|by)\s+(\d{1,2})(?::\d{2})?\s*(?:am|pm)\b/i);
      const currentHour = hourText ? hourText[0] : null;
      const inherited = !currentHour && recentWeatherHour && contextualWeather
        && !/\b(today|tomorrow|week|morning|afternoon|evening|tonight)\b/i.test(cleaned)
        ? ` ${recentWeatherHour}` : '';
      recentWeatherScope = scope;
      recentWeatherAt = Date.now();
      if (currentHour) recentWeatherHour = currentHour;
      else if (/\b(today|tomorrow|week|morning|afternoon|evening|tonight)\b/i.test(cleaned)) recentWeatherHour = null;
      const weather = await getWeatherBriefing(city, scope, cleaned + inherited);
      await addMessage('auren', weather.success
        ? weather.spoken
        : `I couldn't retrieve the forecast for ${city} just now. Please try again shortly.`);
      return;
    }
    // Verified save/delete/project operations remain local. Other conversation goes to AI.
    // Only verified local actions bypass AI. General questions about the user,
    // interests, and recommendations should reach the AI with saved memory context.
    const isLocal = /^(?:help\s*[!?]?|for now\b|just for now\b|this session\b|for this session\b|clear (?:the )?session\b|save session note\b|session\b|what are we working on\b|what am i working on\b|(?:please )?remember\b|search memory for\b|forget\b|new project\b|start project\b|create project\b|project\b|projects\b|list projects\b|yes\s*[.!]?|no\s*[.!]?|confirm\s*[.!]?|cancel\s*[.!]?)$/i.test(text.trim())
      || /^(?:please )?remember\s+/i.test(text)
      || /^(?:forget|new project|start project|create project|project)\s+/i.test(text)
      || /^(?:for now|just for now|this session|for this session|save session note)\s+/i.test(text);
    const reminderResponse = reminderSpeech(text);
    const planResponse = reminderResponse || await planSpeech(text);
    const memoryDispute = isLocal || planResponse ? null : await memoryDisputeReply(text);
    const planningSuggestion = !isLocal && !planResponse && !memoryDispute && !pendingPlan && !planningOffer
      && butlerPreferences.suggestions && Date.now()-lastPlanningOfferAt>PLANNING_OFFER_COOLDOWN_MS ? planningOpportunity(text) : null;
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
