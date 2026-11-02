// AUREN v2.52 — safer appointment and place references, targeted clarification.
// AUREN v2.51 — Longer conversation continuity, bounded non-sensitive topic trail.
// AUREN v2.50 — Multi-turn appointment references and contextual people awareness.
// AUREN v2.49 — Natural topic changes, conversation boundary and relevant memory isolation.
// AUREN v2.48 — Topic-aware saved preferences and grounded contextual assistance.
// AUREN v2.47 — Conversation recovery, bounded follow-ups, safe AI retries.
// AUREN v2.46 — Natural corrections, scoped context and one-question clarifications.
// AUREN v2.45 — Contextual butler personality, concise intent routing, restrained suggestions.
// AUREN v2.44 — Verified long-term memory, transparent recall and preference-aware replies.
// AUREN v2.43 — Advanced Conversation Intelligence: grounded follow-ups and topic reset.
// AUREN v2.42 — Personalized daily preparation, real commitments and restrained next steps.
// AUREN v2.41 — Smarter deadlines, overdue tasks and calendar-safe work suggestions.
// AUREN v2.40 — Confirmed tasks, repeatable routines, and grounded daily task awareness.
// AUREN v2.39 — Adaptive Daily Intelligence: grounded rankings, briefings, and follow-ups.
// AUREN v2.38 — Proactive daily readiness, context-grounded preparation, and safe follow-through.
// AUREN v2.37 — grounded next-action priority intelligence and focused schedule guidance.
// AUREN v2.36 — reliable appointment corrections, confirmed saves and focused follow-through.
// AUREN v2.35 — grounded day follow-ups and concise, context-safe daily guidance.
// AUREN v2.34 — grounded daily intelligence, conflicts, priorities and context.
// AUREN v2.33 — focused nearby popup: results or directions and close.
// AUREN v2.32 — reliable actions, contextual place follow-ups, honest recommendations.
// AUREN v2.31 — conversation-first directions, no navigation loops or repetitive location questions.
// AUREN v2.30 — persistent destination context and chat-to-directions handoff
// AUREN v2.29 — clean voice destinations, device-current-location navigation, useful best-places fallback
// AUREN v2.28 — reliable Maps directions and no failed-search retry loop
// AUREN v2.27 — richer nearby cards, relevant choices, transparent ratings.
// AUREN v2.26 — Reliable profile, direct name recall, seamless Settings.
// AUREN v2.25 — Reliable nearby discovery, spoken results and contextual follow-ups
// AUREN v2.24 — Name-aware wake routing, respectful butler identity, no name correction
// AUREN v2.23 — Nearby Places visible loading, results, and fallback
// AUREN v2.22 — category-aware places, quiet location controls, graceful fallback
// AUREN v2.21 — complete-intent search and simple Maps choices
// AUREN v2.20 — Maps return navigation, concise replies, responsive live captions
// AUREN v2.19 — intent-first directions, immediate Maps popup, contextual responses
// AUREN v2.16.7 — Smart Places controls in Settings; conversation stays clean.
// AUREN v2.16.4 — startup reference repair; topic-switch patience, simplified orb status and subtle Central clock
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
import { createVoice } from './voice.js?v=2.9.8';
import { createIPhoneRecorder } from './iphone-voice.js?v=2.9.5';
import { getAIEndpoint, setAIEndpoint, askAI } from './ai.js';
import { getWeatherBriefing } from './weather.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const butler = new Butler();
// Initialized before voice callbacks; Smart Places replaces the fallback after setup.
let aurenPlaces = { handle: async () => false, clear: () => {} };
const settings = loadSettings();
const HISTORY_LIMIT = 200;
// Conversation continuity lasts across refreshes on this browser.
// Only the last few non-sensitive conversational turns are sent to AI.
const CONVERSATION_KEY = 'auren_ai_recent_v296';
const aiRecent = [];
try {
  const stored = JSON.parse(localStorage.getItem(CONVERSATION_KEY) || '[]');
  if (Array.isArray(stored)) aiRecent.push(...stored.filter(v =>
    v && ['user', 'assistant'].includes(v.role) && typeof v.content === 'string'
  ).slice(-20).map(v => ({role:v.role, content:v.content.slice(0,650)})));
} catch { /* Keep working without saved history. */ }
function rememberConversationTurn(question, answer) {
  const sensitive = classify(question + ' ' + answer);
  // Never keep sensitive chat in the AI context cache.
  if (sensitive.blocked.length || sensitive.sensitive.length) return;
  aiRecent.push({role:'user', content:question.slice(0,650)},
    {role:'assistant', content:answer.slice(0,650)});
  if (aiRecent.length > 20) aiRecent.splice(0, aiRecent.length - 20);
  try { localStorage.setItem(CONVERSATION_KEY, JSON.stringify(aiRecent)); } catch {}
}
let latestBriefingContext = null;
try { const saved = JSON.parse(sessionStorage.getItem('auren_latest_briefing_v213') || 'null');
  if (saved && typeof saved.text === 'string' && Date.now()-saved.at < 45*60000) latestBriefingContext = saved;
} catch {}

const aiEndpointInput = $('aiEndpoint');
window.addEventListener('auren:ai-endpoint-updated', () => { aiEndpointInput.value = getAIEndpoint(); });
aiEndpointInput.value = getAIEndpoint();
$('saveAIEndpoint').onclick = () => { try { setAIEndpoint(aiEndpointInput.value); window.dispatchEvent(new Event('auren:ai-endpoint-changed')); showStatus('AUREN AI connection saved on this browser.', 'ok'); } catch (e) { showStatus(e.message, 'error'); } };
$('clearAIEndpoint').onclick = () => { setAIEndpoint(''); aiEndpointInput.value = ''; showStatus('AI connection removed.', 'info'); };
let storageOk = false, sinceTrim = 0;
// Compact voice subtitles: fixed two lines, with older words rolling away.
// Full messages remain unchanged in Text chat and history.
const captionNode = $('liveTranscript');
// Accessible standalone transcript panel. Does not replace the rotating reminder ticker.
const speechPanel=document.createElement('section');
speechPanel.id='aurenSpeechPanel';
speechPanel.setAttribute('aria-label','Live voice conversation');
speechPanel.style.cssText='box-sizing:border-box;width:min(92%,680px);margin:14px auto 12px;padding:14px 18px;border:1px solid rgba(199,168,104,.38);border-radius:15px;background:rgba(25,27,32,.92);color:#e6d5af;line-height:1.55;text-align:left;min-height:66px;max-height:158px;overflow-y:auto;overflow-wrap:anywhere;font-size:15px;';
const speechPanelTitle=document.createElement('strong');speechPanelTitle.textContent=''; speechPanelTitle.hidden=true;speechPanelTitle.style.cssText='display:block;font-size:10px;letter-spacing:2px;opacity:.75;margin-bottom:5px;';
const speechPanelText=document.createElement('div');speechPanelText.textContent='Your conversation appears here when speaking.';
const chicagoClock=document.createElement('div');chicagoClock.style.cssText='font-size:11px;opacity:.75;margin-top:8px;';
const paintChicagoClock=()=>{chicagoClock.textContent='Dallas · '+new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date());};
paintChicagoClock();setInterval(paintChicagoClock,30000);
speechPanel.append(speechPanelTitle,speechPanelText);
// Keep time as quiet metadata beneath the wake instruction, not a large live badge.
const wakeInstruction=$('wakeHint');
const subtleCentralTime=document.createElement('p');
subtleCentralTime.id='aurenSubtleClock';
subtleCentralTime.style.cssText='font-size:11px;letter-spacing:.07em;opacity:.55;margin:5px auto 0;text-align:center;color:#c9b78e;';
const updateSubtleClock=()=>{subtleCentralTime.textContent='Central time · '+new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date());};
updateSubtleClock();setInterval(updateSubtleClock,30000);
wakeInstruction?.insertAdjacentElement('afterend',subtleCentralTime);
// The clock stays visible as metadata, even while voice is active.


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
  captionNode.textContent = '';
  captionNode.parentElement?.classList.remove('caption-visible');
  speechPanelText.textContent = text ? (speaker ? speaker + ': ' : '') + text : 'Your conversation appears here when speaking.';
  speechPanel.scrollTop=speechPanel.scrollHeight;
}
function clearCaption(delay = 1500) {
  clearTimeout(captionClear);
  captionClear = setTimeout(() => {
    if (!captionSpeaking) showCaption('', '');
  }, delay);
}
function voiceCaptionSpoken(text) {
  // The voice engine signals start and end. Show the first sentence immediately
  // and advance full sentences quickly instead of slowly revealing two words.
  if (captionSpeaking) {
    captionSpeaking = false;
    clearTimeout(captionTimer);
    captionTimer = null;
    clearCaption(1000);
    homeMessageUntil = Date.now() + 1100;
    setTimeout(() => { if (!captionSpeaking) renderUpNext(); }, 1200);
    return;
  }
  captionSpeaking = true;
  clearTimeout(captionTimer);
  const sentences = (String(text || '').match(/[^.!?\n]+(?:[.!?]+|$)/g) || [String(text || '')])
    .map(s => s.trim()).filter(Boolean);
  let index = 0;
  const next = () => {
    if (!captionSpeaking || !sentences.length) return;
    showCaption(sentences[index], 'AUREN');
    if (index < sentences.length - 1) {
      const ms = Math.max(450, Math.min(1350, sentences[index].length * 14));
      captionTimer = setTimeout(() => { index++; next(); }, ms);
    }
  };
  next();
}
const voice = createVoice({
  onInterim: transcript => {
    if (captionSpeaking || Date.now() - lastInterimAt < 200) return;
    lastInterimAt = Date.now();
    showCaption(transcript, 'YOU');
  },
  onSpoken: text => voiceCaptionSpoken(text),
  onTranscript: async transcript => {
    // A voice interruption pauses the briefing everywhere, including its own page.
    // Keep its current segment available; resume only on an explicit request.
    if (briefingPlayer.active) briefingPlayer.pause();
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
  subtleCentralTime.hidden = state !== 'idle';
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
// v2.16.1: spoken replies persist across reloads, with a direct Safari audio test.
const AUREN_SPEECH_PREF='auren_speech_replies_v2161';
let speechWanted=true;
try { const v=localStorage.getItem(AUREN_SPEECH_PREF); if(v!==null) speechWanted=v==='true'; } catch {}
$('speakReplies').checked=capabilities.speak && speechWanted;
voice.setEnabled($('speakReplies').checked);
$('speakReplies').onchange=()=>{
  const on=$('speakReplies').checked;
  voice.setEnabled(on);
  if(on) voice.primeAudio();
  try {localStorage.setItem(AUREN_SPEECH_PREF,String(on));} catch {}
  showStatus(on?'Spoken replies enabled.':'Spoken replies disabled.','info');
};

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
  // Navigation changes the view only. Speaking and briefing continue until interrupted by the user.
  if (screen !== 'settings') lastNonSettingsScreen = screen;
  document.querySelectorAll('nav button, .tab').forEach(node => node.classList.remove('active'));
  target.classList.add('active');
  const tab = document.querySelector(`nav button[data-tab="${screen}"]`);
  if (tab) tab.classList.add('active');
  document.body.dataset.screen = screen;
  const activeMapsOverlay=document.getElementById('aurenMapsTemporaryOverlay');
  if(activeMapsOverlay)activeMapsOverlay.style.display='none';
  const inSettings = screen === 'settings';
  advancedNav.hidden = !inSettings;
  $('panelToggle').setAttribute('aria-expanded', String(inSettings));
  $('panelToggle').setAttribute('aria-label', inSettings ? 'Close Settings' : 'Open Settings');
  $('panelToggle').textContent = inSettings ? '✕' : '⚙';
  if (screen === 'memory') await renderMemories();
  if (screen === 'projects') await renderProjects();
  if (inSettings) { refreshPersonalProfile(); paintPersonal(); await renderStorageInfo(); }
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
orbButton.insertAdjacentElement('afterend',speechPanel);
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
    if (briefingPlayer.active) briefingPlayer.pause();
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
const voiceTestButton=document.createElement('button');
voiceTestButton.type='button';voiceTestButton.textContent='Test AUREN voice';
voiceTestButton.onclick=()=>{
  if(!capabilities.speak){showStatus('This browser does not support spoken replies.','error');return;}
  $('speakReplies').checked=true;voice.setEnabled(true);
  try{localStorage.setItem(AUREN_SPEECH_PREF,'true');}catch{}
  voice.primeAudio();
  voice.speak('At your service. Voice playback is working.');
};
voiceCard.append(voiceTestButton);

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
// Optional foreground check-ins. Never activate microphones or interrupt speech.
const CHECKIN_PREF='auren_opt_in_checkins_v211';
const checkRow=document.createElement('label');checkRow.className='check';checkRow.style.marginTop='14px';
const checkToggle=document.createElement('input');checkToggle.type='checkbox';
checkToggle.checked=localStorage.getItem(CHECKIN_PREF)==='true';
const checkLabel=document.createElement('span');checkLabel.textContent='Occasional spoken calendar and reminder check-ins';
checkRow.append(checkToggle,checkLabel);
const checkHelp=document.createElement('p');checkHelp.className='hint';
checkHelp.textContent='Off by default. When on, AUREN may ask whether you want a check-in while this page is open and voice is active. Never speaks over a reply.';
checkToggle.addEventListener('change',()=>{try{localStorage.setItem(CHECKIN_PREF,String(checkToggle.checked));}catch{};showStatus(checkToggle.checked?'Optional check-ins enabled.':'Optional check-ins disabled.','info');});
voiceCard.append(checkRow,checkHelp);
let lastCheckin=Date.now();let lastActivity=Date.now();
for(const event of ['click','keydown'])document.addEventListener(event,()=>{lastActivity=Date.now();},{passive:true});
setInterval(()=>{
 const now=Date.now();
 if(!checkToggle.checked||document.hidden||!voice.enabled||!voice.awake||voice.speaking||briefingPlayer.active)return;
 if(now-lastCheckin<90*60000||now-lastActivity>15*60000||now-lastActivity<90*1000)return;
 if(!upcomingItems().length)return;
 lastCheckin=now;
 void addMessage('auren','Would you like a quick check-in on your upcoming appointments and reminders?');
},60000);

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
// AUREN clock: timestamps use the device clock; Dallas display is DST-aware.
const BUTLER_ZONE = 'America/Chicago';
function dallasHour(now=new Date()){return Number(new Intl.DateTimeFormat('en-US',{timeZone:BUTLER_ZONE,hour:'numeric',hourCycle:'h23'}).format(now));}
function timeOfDay(now=new Date()){const h=dallasHour(now);return h<5?'night':h<12?'morning':h<17?'afternoon':h<21?'evening':'night';}
function butlerGreeting(now=new Date()){const part=timeOfDay(now);return part==='night'?'Good evening':`Good ${part}`;}

$('planDate').value=localDate();
if(Intl.DateTimeFormat().resolvedOptions().timeZone !== BUTLER_ZONE){console.info('AUREN: device timezone differs from Dallas; appointment input uses device local time.');}
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
// Keep written clock times unambiguous regardless of browser locale.
function formatClock(time){
 const [h,m]=String(time).split(':').map(Number);
 if(!Number.isInteger(h)||h<0||h>23||!Number.isInteger(m)||m<0||m>59)return String(time);
 return `${h%12||12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`;
}
// AUREN speaks the time conversationally, making noon/midnight and AM/PM clear.
function spokenClock(time){
 const [h,m]=String(time).split(':').map(Number);
 if(!Number.isInteger(h)||h<0||h>23||!Number.isInteger(m)||m<0||m>59)return String(time);
 if(h===0&&m===0)return 'midnight';
 if(h===12&&m===0)return 'noon';
 const hr=h%12||12;
 const digits=m?`${hr}:${String(m).padStart(2,'0')}`:String(hr);
 const period=h<5?'at night':h<12?'in the morning':h<17?'in the afternoon':h<21?'in the evening':'at night';
 return `${digits} ${period}`;
}
function spokenDateTime(date,time){return `${readableDate(date)} at ${spokenClock(time)}`;}
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
 const reply=$('latestReply');if(!reply)return;
 const items=upcomingItems();
 reply.textContent=items.length?items[upNextIndex%items.length].text:'Nothing coming up. Your day is clear.';
 reply.setAttribute('aria-label','Upcoming plans and reminders');
}
function refreshUpNext(){upNextIndex=0;renderUpNext();}
function checkReminders(){
 const now=Date.now();let changed=false;
 for(const r of reminders){const at=new Date(r.at).getTime();if(r.fired||!Number.isFinite(at)||at>now)continue;
 r.fired=true;changed=true;
 // A stale reminder encountered after browser sleep/open must not sound like a new alert.
 // It is marked delivered/missed to prevent unexpected immediate announcements.
 if(now-at>90000){
   showStatus('Missed reminder: '+r.text+' (scheduled earlier).','info');
   continue;
 }
 // Clearly mark a due reminder even if the user is in another section.
 showStatus('Reminder: '+r.text,'info');
 if(document.visibilityState==='visible'){
   // Reminder banner handles alert; upcoming ticker continues cycling.
   // Only speak when spoken replies were enabled already; never switch on audio unexpectedly.
   if(voice.enabled&&!voice.speaking)voice.speak('A reminder: '+r.text);
 }
 }
 if(changed){try{saveReminders();}catch(e){showStatus('Reminder could not be recorded: '+e.message,'error');}}
 renderUpNext();
}
setInterval(()=>{checkReminders();upNextIndex++;renderUpNext();},5000);
window.addEventListener('pageshow',checkReminders);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkReminders();});
// Calendar integration is explicitly opt-in. An .ics download lets the user
// import an event into Apple Calendar, Google Calendar or Outlook. No direct
// external calendar write or background sync is claimed.
let calendarOffer = null;
function calendarEscape(s) { return String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
function calendarDateUTC(ms) { return new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'); }
function prepareCalendarOffer(kind, item) {
  return; // No device-calendar downloads; saved items belong to AUREN's own planner.
  const when = kind==='appointment' ? eventTimestamp(item) : new Date(item.at).getTime();
  if(!Number.isFinite(when)) return;
  calendarOffer={kind, title:kind==='appointment'?item.title:'Reminder: '+item.text,
    when, duration:kind==='appointment'?Math.max(1, Number(item.duration)||60):5};
}
function downloadCalendarFile(offer) {
  const start=offer.when, end=start+offer.duration*60000;
  const uidText='auren-'+Date.now()+'-'+Math.floor(Math.random()*1e7)+'@auren.local';
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AUREN//Calendar Export//EN',
   'CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+uidText,
   'DTSTAMP:'+calendarDateUTC(Date.now()),'DTSTART:'+calendarDateUTC(start),
   'DTEND:'+calendarDateUTC(end),'SUMMARY:'+calendarEscape(offer.title),
   'DESCRIPTION:'+calendarEscape('Imported from AUREN. Confirm the calendar app import to save this event.'),
   'END:VEVENT','END:VCALENDAR'];
  const blob=new Blob([lines.join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download='AUREN-calendar-event.ics'; document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function calendarOfferReply(text) {
 if(!calendarOffer) return null;
 const v=String(text||'').trim().toLowerCase().replace(/[.!?]+$/,'');
 if(/^(?:yes|yeah|yep|sure|please|go ahead|add it|add to (?:my |the )?calendar|calendar please|do it)$/.test(v)){
   const offered=calendarOffer;calendarOffer=null;
   downloadCalendarFile(offered);
   return 'I have prepared a calendar file. Open the downloaded file and confirm the import in your calendar app. It is not added until you approve the import.';
 }
 calendarOffer=null;
 if(/^(?:no|nope|no thanks|not now|nah)$/.test(v))return 'Very well. It remains saved in AUREN only.';
 return null;
}
function calendarOfferPrompt() { return ''; } // AUREN calendar is internal; no external import offers.
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
 refreshUpNext();prepareCalendarOffer('reminder',item);
 return `Your reminder is saved for ${minutes} minutes before ${event.title}. It can alert you while AUREN is open.`+calendarOfferPrompt();
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

// Convert human relative durations into a bounded number of minutes.
// Examples: "in 10 minutes", "in half an hour", "in 2 hours", "in an hour".
function relativeReminderMinutes(text) {
 const t=String(text||'').toLowerCase();
 if (/\bin\s+(?:half an hour|half (?:a|an) hour|30 minutes?)\b/.test(t)) return 30;
 if (/\bin\s+(?:a|an|one)\s+hour\b/.test(t)) return 60;
 if (/\bin\s+(?:a|one)\s+minute\b/.test(t)) return 1;
 const match=t.match(/\bin\s+(\d{1,4})\s*(minutes?|mins?|hours?|hrs?)\b/);
 if(!match)return null;
 const minutes=Number(match[1]) * (/^(?:h|hour)/.test(match[2])?60:1);
 return Number.isSafeInteger(minutes)&&minutes>=1&&minutes<=10080?minutes:null;
}
function relativeReminderSubject(text) {
 return String(text).replace(/^(?:please\s+)?(?:remind me|set (?:a )?reminder)\s*/i,'')
  .replace(/\bin\s+(?:half an hour|half (?:a|an) hour|30 minutes?|(?:a|an|one)\s+hour|(?:a|one)\s+minute|\d{1,4}\s*(?:minutes?|mins?|hours?|hrs?))\b/i,'')
  .replace(/^(?:to|about|that|for)\s+/i,'').trim().replace(/[.!?]+$/,'').trim();
}
function saveRelativeReminder(subject, at) {
 const item={id:uid(),text:subject.slice(0,200),at:new Date(at).toISOString(),fired:false};
 reminders.push(item);
 try {saveReminders();} catch(error) {reminders=reminders.filter(r=>r.id!==item.id);return 'I could not save that reminder. Please try again.';}
 refreshUpNext();
 prepareCalendarOffer('reminder',item);
 return `Reminder set for ${new Date(at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.`+calendarOfferPrompt();
}
// Small, local phrase bank: rotates wording without saving private conversations.
// Distinct contexts get distinct sequences; the same phrase is not repeated consecutively.
const phraseIndex = new Map();
function varyButler(context, options) {
 const index = phraseIndex.get(context) || 0;
 phraseIndex.set(context, index + 1);
 return options[index % options.length];
}
function respectfulUncertainty(text) {
 const t=String(text||'').trim().toLowerCase().replace(/[.!?]+$/,'');
 if (!/^(?:idk|i don['’]t know|not sure|i'm not sure|i am not sure|no idea|i dunno)$/.test(t)) return null;
 if(pendingReminder || pendingPlan || planClarification || planningOffer) {
   pendingReminder=null; pendingPlan=null; planClarification=null; planningOffer=null;
   return varyButler('uncertainPending', [
   'Certainly. We can leave that undecided.',
   'No problem. I will leave it as it is.',
   'Very well. We can return to it whenever you wish.',
   'Understood. Nothing needs deciding just now.'
 ]);
 }
 return varyButler('uncertainGeneral', [
   'Understood. We can leave it there.',
   'That is fine. There is no need to decide just yet.',
   'Very well. Take your time.',
   'Of course. We need not settle that right now.'
 ]);
}

function reminderSpeech(t){
 const text=t.trim();
 if(pendingReminder){
  if(pendingReminder.kind==='relative-subject'){
   if(/^(?:no|cancel|nevermind|never mind|not now)\b/i.test(text)){pendingReminder=null;return 'Of course. Nothing was scheduled.';}
   if(/^(?:remind me|set (?:a )?reminder)\b/i.test(text))pendingReminder=null;
   else {
    const draft=pendingReminder; pendingReminder=null;
    const subject=text.replace(/^(?:to|about|that|for)\s+/i,'').trim();
    if(!subject)return 'What would you like me to remind you about?';
    if(draft.at<=Date.now())return 'That time has passed. Please choose another reminder time.';
    return saveRelativeReminder(subject,draft.at);
   }
  }
  if(/^(?:yes|yeah|yep|sure|correct|confirm|do it|please do|go ahead)\b/i.test(text)){
   const p=pendingReminder;pendingReminder=null;
   if(p.kind==='linked'){const event=plans.find(e=>e.id===p.eventId);return event?eventReminder(event,p.minutes):'That appointment no longer exists. No reminder was saved.';}
   if(p.kind==='remove'){const existing=reminders.find(r=>r.id===p.id);reminders=reminders.filter(r=>r.id!==p.id);try{saveReminders();}catch(e){if(existing)reminders.push(existing);return 'I could not save that change.';}refreshUpNext();return 'Certainly. That reminder has been removed.';}
   const item={id:uid(),text:p.text,at:p.at,fired:false};reminders.push(item);try{saveReminders();}catch(e){reminders=reminders.filter(r=>r.id!==item.id);return 'I could not save that reminder.';}refreshUpNext();prepareCalendarOffer('reminder',item);return 'Certainly. I will remind you '+new Date(item.at).toLocaleString([],{weekday:'long',hour:'numeric',minute:'2-digit'})+'.'+calendarOfferPrompt();
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
 const relativeMinutes=relativeReminderMinutes(text);
 if(relativeMinutes!==null){
  const at=Date.now()+relativeMinutes*60000;
  const subject=relativeReminderSubject(text);
  if(!subject){ pendingReminder={kind:'relative-subject',at};return 'Of course. What should I remind you about?'; }
  return saveRelativeReminder(subject,at);
 }
 if(/\bin\s+\d+\s*(?:minute|hour|mins?|hrs?)\b/i.test(text))
   return 'Please choose a reminder between one minute and seven days from now.';
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
 const groups=new Map();for(const p of items){const name=weekdayNames[parseISO(p.date).getDay()];if(!groups.has(name))groups.set(name,[]);groups.get(name).push(`${p.title} at ${spokenClock(p.time)}`);}
 const spoken=[...groups].map(([day,entries])=>`${day}: ${entries.slice(0,3).join(', ')}${entries.length>3?', and more':''}`).join('. ');
 return `This week you have ${items.length} ${items.length===1?'plan':'plans'}. ${spoken}.`;
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
 const raw=String(t||'').toLowerCase();
 const matches=plans.filter(p=>p.title && raw.includes(p.title.toLowerCase()));
 if(matches.length===1)return matches[0];
 if(matches.length>1)return null; // Never guess from two explicit matches.
 // 'it', 'that meeting', etc. refer only to an actual previously discussed event.
 const reference=/\b(?:it|that|the|this|my)\s*(?:meeting|appointment|event|plan)?\b|\b(?:reschedule|move)\s+(?:it|that)\b/i.test(raw);
 if(reference && lastDiscussedPlanId){
   return plans.find(p=>p.id===lastDiscussedPlanId)||null;
 }
 // A user explicitly says the kind of event and only one is on the selected day.
 const generic=/\b(?:meeting|appointment|event|plan)\b/.test(raw);
 const current=plansFor($('planDate').value);
 if(generic&&current.length===1)return current[0];
 return null; // Never silently choose an unrelated old appointment.
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
// v2.34: All daily intelligence is calculated from saved AUREN records.
// No assumed appointments, AI-generated commitments, or unverified travel estimates.
function savedDayIntelligence(date=localDate(), scope='day') {
  const events=(scope==='week'?weekItems(date):plansFor(date)).slice().sort((a,b)=>eventTimestamp(a)-eventTimestamp(b));
  const now=Date.now();
  const start=scope==='week'?weekStart(date):date;
  const end=scope==='week'?shiftedDate(start,6):date;
  const due=reminders.filter(r=>!r.fired&&Number.isFinite(Date.parse(r.at))&&localDate(new Date(r.at))>=start&&localDate(new Date(r.at))<=end)
    .sort((a,b)=>a.at.localeCompare(b.at));
  const conflictPairs=[];
  for(let i=0;i<events.length;i++)for(let j=i+1;j<events.length;j++){
    if(overlaps(events[i],events[j]))conflictPairs.push([events[i],events[j]]);
  }
  const future=events.filter(p=>eventTimestamp(p)>=now);
  const next=future[0]||null;
  const parts=[];
  if(!events.length)parts.push(scope==='week'?'No appointments saved for this week.':'No appointments saved for this day.');
  else {
    parts.push(`${events.length} saved ${events.length===1?'appointment':'appointments'} ${scope==='week'?'this week':'for this day'}.`);
    if(next)parts.push(`Next: ${next.title} on ${readableDate(next.date)} at ${spokenClock(next.time)}.`);
    else parts.push('Those appointments have already passed.');
    if(events.length>1)parts.push('Scheduled: '+events.slice(0,4).map(e=>`${e.title}, ${scope==='week'?readableDate(e.date)+' ':''}${spokenClock(e.time)}`).join('; ')+(events.length>4?'; and more.':'.'));
  }
  if(due.length)parts.push(`${due.length} saved ${due.length===1?'reminder':'reminders'} ${scope==='week'?'this week':'on this day'}. Next reminder: ${due[0].text} at ${new Date(due[0].at).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.`);
  if(conflictPairs.length)parts.push(`Attention: ${conflictPairs.length} scheduling ${conflictPairs.length===1?'conflict':'conflicts'}. ${conflictPairs.slice(0,2).map(([a,b])=>`${a.title} overlaps ${b.title}`).join('; ')}.`);
  return {events,due,conflictPairs,next,spoken:parts.join(' ')};
}
// v2.37: Priority intelligence is derived solely from existing local appointments
// and reminders. It never declares a personal goal or an unsaved task urgent.
function nextActionIntelligence(date=localDate(),scope='day'){
  const report=savedDayIntelligence(date,scope);
  const now=Date.now();
  const appointments=report.events.filter(e=>eventTimestamp(e)>=now);
  const upcomingReminders=report.due.filter(r=>Date.parse(r.at)>=now);
  const candidates=[
    ...appointments.map(e=>({kind:'appointment',when:eventTimestamp(e),name:e.title,date:e.date,time:e.time})),
    ...upcomingReminders.map(r=>({kind:'reminder',when:Date.parse(r.at),name:r.text}))
  ].sort((a,b)=>a.when-b.when);
  if(!candidates.length){
    return 'I cannot see an upcoming appointment or reminder in AUREN for that period. I cannot know your personal priorities without your input.';
  }
  const next=candidates[0];
  const timeLabel=next.kind==='appointment'
    ? `${readableDate(next.date)} at ${spokenClock(next.time)}`
    :new Date(next.when).toLocaleString([],{weekday:'long',hour:'numeric',minute:'2-digit'});
  const minutes=Math.max(0,Math.floor((next.when-now)/60000));
  const lead=next.kind==='reminder'?'Your next saved reminder':'Your next saved appointment';
  let reply=`${lead} is ${next.name}, ${timeLabel}.`;
  if(minutes<=15)reply+=' It is coming up soon.';
  else if(minutes<=60)reply+=` It is in about ${minutes} minutes.`;
  if(report.conflictPairs.length){
    const pair=report.conflictPairs.find(([a,b])=>eventTimestamp(a)>=now||eventTimestamp(b)>=now);
    if(pair)reply+=` Also, ${pair[0].title} and ${pair[1].title} overlap. I can help you review the conflict.`;
  }
  // Avoid claiming that an empty calendar implies genuinely free time.
  reply+=' This is the next time-sensitive item in your saved AUREN schedule, not necessarily your most important personal goal.';
  return reply;
}
function nextOpeningIntelligence(){
  const now=Date.now();
  const upcoming=plans.filter(p=>eventTimestamp(p)>now).sort((a,b)=>eventTimestamp(a)-eventTimestamp(b));
  if(!upcoming.length)return 'There are no upcoming appointments saved in AUREN. That does not confirm your whole day is free.';
  const next=upcoming[0];
  const minutes=Math.floor((eventTimestamp(next)-now)/60000);
  if(minutes<=0)return `${next.title} is due now according to your saved schedule.`;
  if(minutes<15)return `${next.title} begins in about ${minutes} minutes. I cannot estimate preparation or travel time without more information.`;
  return `You have about ${minutes} minutes until your saved appointment, ${next.title}, at ${spokenClock(next.time)}. That is calendar time, not a guarantee you have enough time to travel or complete another task.`;
}
// v2.38 — Preparation guidance is anchored exclusively to locally saved time data.
// These are *calendar* estimates, not assumed travel, preparation, or importance.
let readinessContext=null;
function nextCommitmentFor(date=localDate()){
  const now=Date.now();
  return plans.filter(p=>p.date===date && eventTimestamp(p)>now)
    .sort((a,b)=>eventTimestamp(a)-eventTimestamp(b))[0]||null;
}
function readinessReport(date=localDate()){
  const now=Date.now(), event=nextCommitmentFor(date);
  const pending=reminders.filter(r=>!r.fired&&Date.parse(r.at)>now&&localDate(new Date(r.at))===date)
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const overlaps=event?conflictingEvents(event,event.id).filter(p=>eventTimestamp(p)>=now):[];
  if(!event){
    return {reply:pending.length?`Your next saved reminder is ${pending[0].text}. I see no upcoming appointment for that day in AUREN.`:'I see no upcoming appointments or reminders saved for that day in AUREN. That does not mean you have no other commitments.',event:null};
  }
  const mins=Math.max(0,Math.floor((eventTimestamp(event)-now)/60000));
  let reply=`Your next saved appointment is ${event.title} at ${spokenClock(event.time)}${date===localDate()?`, in about ${mins} minutes`:''}.`;
  if(date===localDate())reply+=mins<30?' It is soon; consider anything you personally need to prepare.':` You have roughly ${mins} minutes of calendar time until it starts, but I cannot estimate preparation or travel time.`;
  if(pending.length)reply+=` You also have ${pending.length} upcoming saved reminder${pending.length===1?'':'s'} that day.`;
  if(overlaps.length)reply+=` There is an overlap with ${overlaps[0].title}. Nothing has been changed.`;
  return {reply,event};
}
function proactiveDayIntent(raw){
 const q=String(raw||'').trim().toLowerCase().replace(/[.!?]+$/,'');
 if(/^(?:anything i should (?:do|prepare|know) (?:beforehand|before my next (?:appointment|meeting))|how should i prepare for (?:my )?next (?:meeting|appointment)|how much time (?:have i got|do i have) before (?:my )?next (?:meeting|appointment)|is there anything i need to do before (?:my )?next (?:meeting|appointment)|how should i plan (?:my )?(?:afternoon|day)|am i cutting it close(?: for my next appointment)?|do i have (?:enough )?time before my next (?:meeting|appointment))$/.test(q))return {kind:'readiness',date:parseDateIntent(q)||localDate()};
 if(/^(?:check (?:my )?(?:upcoming )?conflicts|warn me about (?:schedule )?conflicts|what might overlap(?: today| tomorrow| this week)?|any overlaps coming up)$/.test(q))return {kind:'conflicts',date:parseDateIntent(q)||localDate()};
 return null;
}
function proactiveDayReply(intent){
 if(intent.kind==='conflicts'){
  const report=savedDayIntelligence(intent.date,'day');
  return report.conflictPairs.length?'Upcoming saved overlaps: '+report.conflictPairs.slice(0,2).map(([a,b])=>`${a.title} and ${b.title} at ${spokenClock(a.time)}`).join('; ')+'. I have not changed anything.':'I found no overlapping appointments in AUREN for that day.';
 }
 const report=readinessReport(intent.date);
 readinessContext={eventId:report.event?.id||null,date:intent.date,at:Date.now()};
 noteDayConversation(intent.date,'day');
 return report.reply;
}
function readinessFollowup(raw){
 if(!readinessContext||Date.now()-readinessContext.at>4*60000)return null;
 const q=String(raw||'').trim().toLowerCase().replace(/[.!?]+$/,'');
 const event=plans.find(p=>p.id===readinessContext.eventId);
 if(/^(?:anything (?:else|i should do) beforehand|what should i prepare|what about getting ready|is that enough time|what about travel time)$/.test(q)){
  readinessContext.at=Date.now();
  if(!event)return 'I do not have a saved upcoming appointment to prepare for. What is the commitment?';
  return `For ${event.title}, I can confirm the scheduled time is ${spokenClock(event.time)}. Preparation and travel duration are not saved, so I cannot promise you have enough time.`;
 }
 if(/^(?:i(?:'ll| will) do that later|not now|maybe later|leave it for later)$/.test(q)){
   readinessContext=null;
   return 'Certainly. I have not scheduled or changed anything.';
 }
 return null;
}
// v2.39: single adaptive schedule context; all responses derive from saved data.
let adaptiveContext=null;
function adaptiveContextSet(date,scope='day',focusId=null){adaptiveContext={date,scope,focusId,at:Date.now()};}
function adaptiveItems(date,scope='day'){
 const report=savedDayIntelligence(date,scope), now=Date.now();
 const items=[...report.events.filter(p=>eventTimestamp(p)>=now).map(p=>({kind:'appointment',when:eventTimestamp(p),text:p.title,id:p.id,time:p.time,date:p.date})),
 ...report.due.filter(r=>!r.fired&&Date.parse(r.at)>=now).map(r=>({kind:'reminder',when:Date.parse(r.at),text:r.text,id:r.id}))];
 return {report,items:items.sort((a,b)=>a.when-b.when)};
}
// v2.40 — Device-local tasks. These are NOT appointments or background notifications.
const AUREN_TASKS_KEY='auren_tasks_v240';
let aurenTasks=[];
let pendingTaskChange=null;
let lastTaskId=null;
try {
 const saved=JSON.parse(localStorage.getItem(AUREN_TASKS_KEY)||'[]');
 if(Array.isArray(saved)) aurenTasks=saved.filter(x=>x&&typeof x.id==='string'&&typeof x.title==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x.due)&&['once','daily','weekdays'].includes(x.repeat)).slice(0,300);
} catch {}
function saveAurenTasks(){
 const data=JSON.stringify(aurenTasks);
 try {localStorage.setItem(AUREN_TASKS_KEY,data);if(localStorage.getItem(AUREN_TASKS_KEY)!==data)throw new Error('Read-back failed');return true;}
 catch(e){showStatus('Could not save AUREN tasks: '+e.message,'error');return false;}
}
function isTaskComplete(t,date=localDate()){
 return t.repeat==='once'?!!t.done:!!(Array.isArray(t.completedDates)&&t.completedDates.includes(date));
}
function taskOnDay(t,date){
 if(t.repeat==='once')return t.due===date;
 if(date<t.due)return false;
 if(t.repeat==='daily')return true;
 const day=parseISO(date).getDay();return day!==0&&day!==6;
}
function tasksOnDate(date,includeComplete=false){
 return aurenTasks.filter(t=>taskOnDay(t,date)&&(includeComplete||!isTaskComplete(t,date)));
}
function taskBrief(date,scope='day',detailed=false){
 let days=[date];
 if(scope==='week'){const start=weekStart(date);days=Array.from({length:7},(_,i)=>shiftedDate(start,i));}
 const today=localDate();const upcoming=days.flatMap(day=>tasksOnDate(day).map(task=>({task,day}))).filter(x=>x.day>=today);
 if(!upcoming.length)return detailed?'No unfinished AUREN tasks due in that period.':'';
 const top=upcoming.slice(0,detailed?5:2).map(x=>`${x.task.title}${scope==='week'?' ('+readableDate(x.day)+')':''}`);
 return `${upcoming.length} unfinished task${upcoming.length===1?'':'s'} scheduled for this period: ${top.join('; ')}${upcoming.length>top.length?'; and more':''}.`;
}
function taskIntent(raw){
 const q=String(raw||'').trim().replace(/^(?:(?:hey|hi)\s+)?auren[,! ]*/i,'').replace(/[.!?]+$/,'').trim();
 if(!q)return null;
 if(/^(?:what(?:'s| is| are) (?:on )?my (?:task list|tasks|to.do list)|what tasks (?:do i have|are due)|show (?:me )?my tasks|list (?:my )?tasks|what do i need to get done)(?:\s+(today|tomorrow|this week))?$/i.test(q))return {kind:'list',date:parseDateIntent(q)||localDate(),scope:/\bweek\b/i.test(q)?'week':'day'};
 if(/^(?:what routines (?:do i have|are saved)|show (?:me )?my routines|list (?:my )?routines)$/i.test(q))return {kind:'routines'};
 if(/^(?:i (?:finished|completed|did)|i(?:'m| am) done with|mark|complete|finish|done with)\s+(.+)$/i.test(q)){
  const m=q.match(/^(?:i (?:finished|completed|did)|i(?:'m| am) done with|mark|complete|finish|done with)\s+(.+)$/i);
  return {kind:'complete',subject:m[1].replace(/\s+(?:as )?(?:done|complete|completed)$/i,'').trim()};
 }
 if(/^(?:remove|delete|cancel)\s+(?:my\s+|the\s+)?task\s+(.+)$/i.test(q))return {kind:'delete',subject:q.replace(/^(?:remove|delete|cancel)\s+(?:my\s+|the\s+)?task\s+/i,'')};
 const daily=q.match(/^(?:add|create|set|start|save)\s+(?:a\s+)?(daily|weekday|weekdays)\s+(?:routine|task)\s+(?:to\s+|for\s+)?(.+)$/i);
 if(daily)return {kind:'add',title:daily[2].trim(),due:localDate(),repeat:/weekday/i.test(daily[1])?'weekdays':'daily'};
 const explicit=q.match(/^(?:add|create|save|put|make)\s+(?:a\s+)?(?:task|to.do)\s+(?:to\s+|for\s+)?(.+)$/i);
 const natural=q.match(/^i\s+(?:need|have|got)\s+to\s+(.+?)\s+(?:by|before|on|due)\s+(tomorrow|today|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))$/i);
 if(!explicit&&!natural)return null;
 const phrase=(explicit?explicit[1]:natural[1]).trim();
 const date=parseDateIntent(phrase)||(natural?parseDateIntent(natural[2]):null);
 const clean=phrase.replace(/\s+(?:(?:by|before|on|due)\s+)?(?:today|tomorrow|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))$/i,'').trim();
 return {kind:'add',title:clean,due:date||localDate(),repeat:'once'};
}
function findTaskSubject(subject){
 const q=String(subject||'').toLowerCase().replace(/^(?:the|my|that|this)\s+/,'').trim();
 if(/^(?:it|that|the task)$/.test(q)&&lastTaskId)return aurenTasks.find(x=>x.id===lastTaskId)||null;
 const exact=aurenTasks.filter(x=>x.title.toLowerCase()===q);
 if(exact.length===1)return exact[0];
 const partial=aurenTasks.filter(x=>x.title.toLowerCase().includes(q)&&q.length>=3);
 return partial.length===1?partial[0]:null;
}
function taskResponse(intent){
 if(intent.kind==='routines'){
  const routines=aurenTasks.filter(t=>t.repeat!=='once');
  return routines.length?'Saved routines: '+routines.slice(0,8).map(t=>`${t.title} (${t.repeat})`).join('; ')+'.':'You have no saved routines yet.';
 }
 if(intent.kind==='list'){
  const summary=taskBrief(intent.date,intent.scope,true);
  return summary||'You have no unfinished tasks recorded for that period.';
 }
 if(intent.kind==='add'){
  if(!intent.title||intent.title.length>120)return 'Please give the task a short name.';
  if(intent.due<localDate())return 'That due date has already passed. Please choose today or a future date.';
  pendingTaskChange={kind:'add',title:intent.title.slice(0,120),due:intent.due,repeat:intent.repeat};
  const when=intent.repeat==='once'?`due ${readableDate(intent.due)}`:intent.repeat==='daily'?'repeating daily':'repeating on weekdays';
  return `Shall I save ${pendingTaskChange.title} as a task, ${when}?`;
 }
 const task=findTaskSubject(intent.subject);
 if(!task)return 'I could not identify a single saved task by that name. Please say the task title.';
 pendingTaskChange={kind:intent.kind,id:task.id};lastTaskId=task.id;
 return intent.kind==='delete'?`Shall I delete the task ${task.title}?`:`Shall I mark ${task.title} complete${task.repeat==='once'?'':' for today'}?`;
}
function taskConfirmation(text){
 if(!pendingTaskChange)return null;
 const q=String(text||'').trim();
 if(/^(?:no|nope|cancel|never mind|not now|stop)[.!? ]*$/i.test(q)){pendingTaskChange=null;return 'Understood. No task was changed.';}
 if(/^(?:yes|yeah|yep|sure|confirm|save it|do it|go ahead|mark it done|please do)[.!? ]*$/i.test(q)){
  const change=pendingTaskChange;pendingTaskChange=null;
  const before=JSON.parse(JSON.stringify(aurenTasks));
  if(change.kind==='add'){
   const task={id:uid(),title:change.title,due:change.due,repeat:change.repeat,done:false,completedDates:[]};
   aurenTasks.push(task);lastTaskId=task.id;
   if(!saveAurenTasks()){aurenTasks=before;return 'I could not save that task on this browser.';}
   return `Saved ${task.title}${task.repeat==='once'?' for '+readableDate(task.due):' as a '+task.repeat+' routine'}.`;
  }
  const task=aurenTasks.find(t=>t.id===change.id);
  if(!task)return 'That task no longer exists.';
  if(change.kind==='delete')aurenTasks=aurenTasks.filter(t=>t.id!==task.id);
  else if(task.repeat==='once')task.done=true;
  else task.completedDates=[...new Set([...(task.completedDates||[]),localDate()])].slice(-90);
  if(!saveAurenTasks()){aurenTasks=before;return 'I could not save that change.';}
  return change.kind==='delete'?`Removed ${task.title}.`:`Marked ${task.title} complete${task.repeat==='once'?'':' for today'}.`;
 }
 if(/^(?:actually|instead|change that|make it)\b/i.test(q)){pendingTaskChange=null;return null;}
 // A completely different request should not get stuck behind a confirmation.
 pendingTaskChange=null;return null;
}

// v2.41 — Deadline planning is read-only: a suggestion never creates a calendar event.
let deadlineContext=null;
function deadlineOpenTasks(){return aurenTasks.filter(t=>t.repeat==='once'&&!t.done).sort((a,b)=>a.due.localeCompare(b.due)||a.title.localeCompare(b.title));}
function deadlineDaysAway(date){const a=parseISO(localDate()),b=parseISO(date);return Math.round((b-a)/86400000);}
function deadlineLabel(task){const days=deadlineDaysAway(task.due);return days<0?`${Math.abs(days)} day${days===-1?'':'s'} overdue`:days===0?'due today':days===1?'due tomorrow':`due ${readableDate(task.due)}`;}
function deadlineFindTask(phrase){
 const q=String(phrase||'').toLowerCase().replace(/[?.!]+$/,'').replace(/^(?:my|the|that)\s+/,'').trim();
 const open=deadlineOpenTasks();
 if(/^(?:it|that|the task|my task|my project)$/.test(q)&&deadlineContext&&Date.now()-deadlineContext.at<600000)return open.find(t=>t.id===deadlineContext.id)||null;
 const matches=open.filter(t=>t.title.toLowerCase()===q||t.title.toLowerCase().includes(q)&&q.length>=3);
 return matches.length===1?matches[0]:null;
}
function deadlineAvailableSlot(task){
 const now=new Date(),today=localDate();
 if(task.due<today)return null;
 // Earliest hour-long unoccupied calendar slot, never implying travel or preparation time.
 for(let day=today;day<=task.due;day=shiftedDate(day,1)){
   let start=9*60;
   if(day===today)start=Math.max(start,Math.ceil((now.getHours()*60+now.getMinutes()+15)/15)*15);
   for(;start+60<=20*60;start+=15){
     const slot={date:day,time:`${String(Math.floor(start/60)).padStart(2,'0')}:${String(start%60).padStart(2,'0')}`,duration:60};
     if(!plansFor(day).some(p=>overlaps(slot,p)))return slot;
   }
 }
 return null;
}
function deadlineIntent(raw){
 const q=String(raw||'').trim().replace(/^(?:(?:hey|hi)\s+)?auren[,! ]*/i,'').replace(/[?.!]+$/,'').trim();
 if(/^(?:what(?:'s| is) (?:due|overdue|coming due)|what tasks? (?:are|is) (?:due|overdue)|do i have any overdue tasks?|show (?:me )?(?:my )?deadlines|what deadlines? (?:do i have|are coming up)|what needs to be finished (?:soon|this week)|what should i (?:finish|work on) before (?:my )?deadlines?)(?:\s+(?:today|tomorrow|this week|next week))?$/i.test(q))return {kind:'overview',scope:/\bweek\b/i.test(q)?'week':/\btomorrow\b/i.test(q)?'tomorrow':/\btoday\b/i.test(q)?'today':'soon',overdue:/\boverdue\b/i.test(q)};
 const plan=q.match(/^(?:when (?:can|could|should) i (?:work on|start|finish|make time for)|find (?:me )?time (?:to work on|for)|help me (?:plan|make time for)|suggest (?:a )?(?:time|slot) (?:for|to work on))\s+(.+)$/i);
 if(plan)return {kind:'slot',subject:plan[1]};
 if(/^(?:when (?:can|should) i work on (?:it|that)|what time could i work on (?:it|that)|find time for (?:it|that))$/i.test(q))return {kind:'slot',subject:'it'};
 return null;
}
function deadlineReply(intent){
 if(intent.kind==='overview'){
  let tasks=deadlineOpenTasks();
  if(intent.overdue)tasks=tasks.filter(t=>t.due<localDate());
  else if(intent.scope==='today')tasks=tasks.filter(t=>t.due<=localDate());
  else if(intent.scope==='tomorrow')tasks=tasks.filter(t=>t.due===shiftedDate(localDate(),1));
  else if(intent.scope==='week')tasks=tasks.filter(t=>t.due<=shiftedDate(localDate(),7));
  else tasks=tasks.filter(t=>t.due<=shiftedDate(localDate(),7));
  if(!tasks.length)return intent.overdue?'You have no overdue unfinished tasks saved in AUREN.':'I do not see any unfinished one-time tasks with deadlines in that period. This only reflects tasks saved in AUREN.';
  deadlineContext={id:tasks[0].id,at:Date.now()};
  const listing=tasks.slice(0,4).map(t=>`${t.title} (${deadlineLabel(t)})`).join('; ');
  return `${tasks.length} unfinished task${tasks.length===1?'':'s'} to review: ${listing}${tasks.length>4?'; and more':''}. These are saved deadlines, not a ranking of personal importance.`;
 }
 const task=deadlineFindTask(intent.subject);
 if(!task)return 'Which unfinished task do you mean? Please tell me its saved name.';
 deadlineContext={id:task.id,at:Date.now()};
 const slot=deadlineAvailableSlot(task);
 if(!slot)return task.due<localDate()?`${task.title} is ${deadlineLabel(task)}. I cannot suggest a slot before a deadline that has passed. You can choose a new deadline.`:`I cannot find a free hour between 9 AM and 8 PM before ${task.title} is due, based on your saved appointments.`;
 return `${task.title} is ${deadlineLabel(task)}. Your AUREN calendar shows a possible one-hour opening ${readableDate(slot.date)} at ${formatClock(slot.time)}. This is only a suggestion; nothing has been scheduled, and I cannot account for travel or commitments outside AUREN.`;
}


// v2.42 — Personal daily preparation. Read-only and grounded in saved AUREN data.
let preparationContext=null;
function preparationUpcoming(date,scope='day'){
 const now=Date.now(), last=scope==='week'?shiftedDate(weekStart(date),6):date;
 const events=plans.filter(p=>p.date>=date&&p.date<=last&&eventTimestamp(p)>=now)
   .sort((a,b)=>eventTimestamp(a)-eventTimestamp(b));
 const dueReminders=reminders.filter(r=>!r.fired&&Date.parse(r.at)>=now&&localDate(new Date(r.at))>=date&&localDate(new Date(r.at))<=last)
   .sort((a,b)=>a.at.localeCompare(b.at));
 const openTasks=aurenTasks.filter(t=>!isTaskComplete(t,date)&&((t.repeat==='once'&&t.due<=last)||(t.repeat!=='once'&&taskOnDay(t,date))))
   .sort((a,b)=>a.due.localeCompare(b.due));
 return {events,dueReminders,openTasks};
}
function preparationIntent(raw){
 const q=String(raw||'').trim().toLowerCase().replace(/^(?:(?:hey|hello)\s+)?auren[,! ]*/,'').replace(/[.!?]+$/,'').trim();
 const date=parseDateIntent(q)||localDate(),scope=/\b(?:this|next) week\b|\bweekly\b/.test(q)?'week':'day';
 if(/^(?:what (?:do i|should i|can i) (?:prepare|get ready|do) (?:for|before) (?:my )?(?:day|today|tomorrow|this week|next week|next meeting|next appointment)|help me (?:prepare|get ready) for (?:my )?(?:day|today|tomorrow|this week|next week|next appointment|next meeting)|(?:give me|make me|what(?:'s| is)) (?:a |my |the )?(?:daily |morning |today(?:'s)? |tomorrow(?:'s)? )?(?:preparation|prep|readiness) (?:checklist|plan|brief|summary)|what (?:should|do) i (?:get ready for|need to prepare) (?:today|tomorrow|this week|next week))$/.test(q))return {kind:'overview',date,scope};
 if(/^(?:what should i prepare|anything i should prepare|anything to prepare|how do i prepare for that|how can i get ready for that|what should i do beforehand|what do i need beforehand|what about preparing for it)$/.test(q))return {kind:'follow'};
 if(/^(?:what(?:'s| is) the next thing i need to get ready for|what should i get ready for next|do i need to prepare for my next appointment)$/.test(q))return {kind:'overview',date:localDate(),scope:'week'};
 return null;
}
function preparationReply(intent){
 const cached=intent.kind==='follow'&&preparationContext&&Date.now()-preparationContext.at<5*60000?preparationContext:null;
 if(intent.kind==='follow'&&!cached)return 'Which appointment or day would you like to prepare for?';
 const date=cached?cached.date:intent.date,scope=cached?cached.scope:intent.scope;
 const {events,dueReminders,openTasks}=preparationUpcoming(date,scope);
 const nextEvent=events[0],nextReminder=dueReminders[0],nextTask=openTasks[0];
 preparationContext={date,scope,eventId:nextEvent?.id||null,at:Date.now()};
 const label=scope==='week'?'the coming week':date===localDate()?'today':date===shiftedDate(localDate(),1)?'tomorrow':readableDate(date);
 if(!nextEvent&&!nextReminder&&!nextTask)return `I don't see any upcoming appointments, reminders or unfinished tasks in AUREN for ${label}. I can't see commitments you haven't saved.`;
 const parts=[];
 if(nextEvent){
   const when=eventTimestamp(nextEvent),minutes=Math.max(0,Math.floor((when-Date.now())/60000));
   const datePart=readableDate(nextEvent.date),time=spokenClock(nextEvent.time);
   parts.push(`Your next saved appointment is ${nextEvent.title} on ${datePart} at ${time}${minutes<=120?`, in about ${minutes} minutes`:''}. Check any details you need for it; AUREN has no saved preparation checklist for that appointment.`);
 }
 if(nextTask)parts.push(`An unfinished task to review is ${nextTask.title}, ${nextTask.repeat==='once'?deadlineLabel(nextTask):'part of your routine'}.`);
 if(nextReminder)parts.push(`Your next reminder is ${nextReminder.text} at ${new Date(nextReminder.at).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'})}.`);
 const overlapping=events.some((a,i)=>events.slice(i+1).some(b=>overlaps(a,b)));
 if(overlapping)parts.push('There is an overlap between saved appointments; check the times before making other plans.');
 parts.push('No changes have been made.');
 return parts.join(' ');
}

function adaptivePriority(date,scope='day'){
 const {report,items}=adaptiveItems(date,scope);
 if(!items.length)return 'I have no upcoming appointments or reminders saved for that period. I cannot rank personal goals I do not know.';
 const next=items[0],mins=Math.max(0,Math.round((next.when-Date.now())/60000));
 adaptiveContextSet(date,scope,next.id);
 let answer=`Your next time-sensitive item is ${next.text}, ${next.kind==='reminder'?'a reminder':'an appointment'}, at ${new Date(next.when).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'})}.`;
 if(mins<=30)answer+=' It is coming up soon.';
 if(report.conflictPairs.length)answer+=` You also have ${report.conflictPairs.length} saved schedule overlap${report.conflictPairs.length===1?'':'s'} to review.`;
 const pendingTasks=taskBrief(date,scope,false);if(pendingTasks)answer+=' '+pendingTasks;
 answer+=' This is based on timing, not a judgment about what matters most to you.';
 return answer;
}
function adaptiveBriefing(date,scope,detail){
 const {report,items}=adaptiveItems(date,scope);
 adaptiveContextSet(date,scope,items[0]?.id||null);
 const label=scope==='week'?'this week':date===localDate()?'today':readableDate(date);
 if(!items.length)return `For ${label}, AUREN has no upcoming saved appointments or reminders. ${taskBrief(date,scope,detail==='detailed')} I cannot see commitments outside your planner.`;
 const next=items[0];
 if(detail==='quick')return `For ${label}, you have ${report.events.length} saved appointment${report.events.length===1?'':'s'} and ${report.due.length} reminder${report.due.length===1?'':'s'}. Next is ${next.text} at ${new Date(next.when).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}.${report.conflictPairs.length?' There is a scheduling conflict.':''} ${taskBrief(date,scope,false)}`;
 const events=report.events.slice(0,5).map(e=>`${e.title} at ${spokenClock(e.time)}${scope==='week'?' on '+readableDate(e.date):''}`);
 const due=report.due.slice(0,4).map(r=>`${r.text} at ${new Date(r.at).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'})}`);
 return `Your detailed briefing for ${label}: ${events.length?'Appointments: '+events.join('; ')+'.':'No appointments saved.'} ${due.length?'Reminders: '+due.join('; ')+'.':'No reminders saved.'} ${report.conflictPairs.length?'Overlaps: '+report.conflictPairs.slice(0,3).map(([a,b])=>`${a.title} and ${b.title}`).join('; ')+'.':'No saved appointment overlaps found.'} Your next time-sensitive item is ${next.text}. ${taskBrief(date,scope,true)}`;
}
function adaptiveIntent(raw){
 const q=String(raw||'').trim().toLowerCase().replace(/[.!?]+$/,'').replace(/^(?:hey )?auren[, ]+/,'');
 const date=parseDateIntent(q)||localDate(),scope=/\b(?:week|weekly)\b/.test(q)?'week':'day';
 if(/^(?:give me |can i have |i want |read me )?(?:a |my |the )?(?:quick|short|15.second|fifteen.second|detailed|full|long)\s+(?:(?:daily|day|morning|weekly|week)\s+)?(?:briefing|summary|overview|breakdown)(?:\s+(?:for|of)\s+(?:today|tomorrow|this week|next week))?$/.test(q))return {kind:'brief',date,scope,detail:/\b(?:detailed|full|long)\b/.test(q)?'detailed':'quick'};
 if(/^(?:what(?:'s| is) (?:important|most important|most urgent) (?:today|tomorrow|this week)|rank my (?:priorities|commitments)|what should i prioritize (?:today|tomorrow|this week)|help me prioritize (?:my )?(?:day|week|schedule))$/.test(q))return {kind:'priority',date,scope};
 return null;
}
function adaptiveFollowup(raw){
 if(!adaptiveContext||Date.now()-adaptiveContext.at>5*60000)return null;
 const q=String(raw||'').trim().toLowerCase().replace(/[.!?]+$/,'');
 const {date,scope}=adaptiveContext;
 if(/^(?:give me (?:more|the details)|go into detail|more detail|the detailed version|tell me more about my day)$/.test(q))return adaptiveBriefing(date,scope,'detailed');
 if(/^(?:shorter|quick version|summarize that|just the highlights)$/.test(q))return adaptiveBriefing(date,scope,'quick');
 if(/^(?:what about afterward|what about after that|what comes after (?:that|my meeting)|and afterward|anything after that)$/.test(q)){
  const {items}=adaptiveItems(date,scope);
  const index=Math.max(0,items.findIndex(x=>x.id===adaptiveContext.focusId));
  const next=items[index+1];adaptiveContext.at=Date.now();
  if(!next)return 'I do not see another upcoming commitment saved for that period after it. That does not mean your time is definitely free.';
  adaptiveContext.focusId=next.id;
  return `After that, your next saved ${next.kind} is ${next.text} at ${new Date(next.when).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'})}.`;
 }
 return null;
}
function priorityIntelligenceIntent(raw){
  const q=String(raw||'').trim().toLowerCase().replace(/[.!?]+$/,'');
  if(!/^(?:what should i (?:do|work on|focus on|prioritize) next|what do i need to do next|what needs my attention(?: next| today| tomorrow| this week)?|what(?:'s| is) (?:my )?next priority|what(?:'s| is) coming up next|what should i do first|what(?:'s| is) most urgent(?: today| tomorrow| this week)?|what should i tackle (?:first|next)|what is my next commitment)(?: please)?$/.test(q))return null;
  const date=parseDateIntent(q)||localDate();
  return {date,scope:/\b(?:week|weekly)\b/.test(q)?'week':'day'};
}
function dailyIntelligenceIntent(t){
  const q=String(t||'').trim().toLowerCase().replace(/[.!?]+$/,'');
  if(/^(?:how(?:'s| is) my (?:day|schedule|week)(?: looking)?|how(?:'s| is) (?:today|tomorrow|this week) looking|what(?:'s| is) (?:the )?(?:plan|priority|schedule) for (?:today|tomorrow|this week)|give me (?:a|my) (?:quick )?(?:day|daily|weekly|morning) (?:overview|briefing|summary)|what should i (?:focus on|prioritize) (?:today|tomorrow|this week)|any (?:schedule )?conflicts (?:today|tomorrow|this week)?|am i (?:busy|free) (?:today|tomorrow|this week))$/.test(q))return {date:parseDateIntent(q)||localDate(),scope:/\b(?:week|weekly)\b/.test(q)?'week':'day'};
  return null;
}
function spokenDayIntelligence(date,scope='day'){
  const report=savedDayIntelligence(date,scope);
  if(!report.events.length&&!report.due.length)return `Based on your AUREN planner, ${scope==='week'?'this week':'that day'} has no saved appointments or reminders. I can't tell whether you have plans outside AUREN.`;
  let text=report.spoken;
  if(report.conflictPairs.length)text+=' Would you like me to review the conflicting appointments?';
  else if(report.next)text+=' I can help you plan around it if you wish.';
  return text;
}
// v2.35: Only inherit calendar context from an actual day-summary conversation.
// Expire it quickly so unrelated questions never get hijacked by planner logic.
let dayConversation=null;
function noteDayConversation(date,scope){dayConversation={date,scope,at:Date.now()};}
function dayFollowupReply(raw){
  if(!dayConversation || Date.now()-dayConversation.at>5*60*1000)return null;
  const q=String(raw||'').trim().toLowerCase().replace(/[.!?]+$/,'');
  const period=/^(?:what about|how about|and|what's on|what is on) (?:my )?(today|tomorrow|this week|next week)$/.exec(q);
  if(period){
    const date=parseDateIntent(period[1])||localDate();
    const scope=period[1].includes('week')?'week':'day';
    noteDayConversation(date,scope);
    return spokenDayIntelligence(date,scope);
  }
  const allowed=/^(?:what(?:'s| is) next|what (?:else|comes after that)|anything else|what about (?:the )?reminders|any reminders|what reminders|when(?:'s| is) (?:my |the )?next (?:appointment|meeting|plan)|how much (?:free )?time (?:do i have|is there)|any (?:schedule )?conflicts|what about (?:the )?conflicts|tell me (?:more )?about (?:the )?conflicts|which (?:ones|appointments) overlap|what should i do first|what should i focus on|what's my priority|and after that)$/i;
  if(!allowed.test(q))return null;
  dayConversation.at=Date.now();
  const {date,scope}=dayConversation;
  const report=savedDayIntelligence(date,scope);
  const future=report.events.filter(p=>eventTimestamp(p)>=Date.now());
  if(/reminder/.test(q))return report.due.length
    ? `You have ${report.due.length} saved reminder${report.due.length===1?'':'s'}: ${report.due.slice(0,3).map(r=>`${r.text}, ${new Date(r.at).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'})}`).join('; ')}.`
    : 'No reminders are saved for that period in AUREN.';
  if(/conflict|overlap/.test(q))return report.conflictPairs.length
    ? 'These saved appointments overlap: '+report.conflictPairs.slice(0,3).map(([a,b])=>`${a.title} and ${b.title} on ${readableDate(a.date)}`).join('; ')+'. No changes have been made.'
    : 'I found no overlapping appointments in AUREN for that period.';
  if(/free time/.test(q))return 'I can see gaps between saved appointments, but that does not guarantee you are free. Ask me to find an opening if you want a time suggestion.';
  if(/else|after that/.test(q))return future.length>1
    ? `After ${future[0].title}, you have ${future[1].title} on ${readableDate(future[1].date)} at ${spokenClock(future[1].time)}.`
    : future.length===1?'No other future appointments are saved in AUREN for that period.':'No further appointments are saved for that period.';
  if(/priority|focus|first/.test(q))return nextActionIntelligence(date,scope);
  return future.length
    ? `Next is ${future[0].title} on ${readableDate(future[0].date)} at ${spokenClock(future[0].time)}.`
    : 'You have no upcoming appointments saved for that period in AUREN.';
}
function planSummary(date){const items=plansFor(date); if(!items.length)return 'You have nothing scheduled for this day.';const names=items.slice(0,5).map(p=>`${p.title} at ${spokenClock(p.time)}`).join(', ');return `You have ${items.length} ${items.length===1?'plan':'plans'}: ${names}${items.length>5?', and others':''}.`;}
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
  const overlapping = conflictingEvents(event);
  plans.push(event);
  try{
    savePlans();
    pendingPlan=null;
    $('planTitle').value='';
    renderDay();
     showStatus(overlapping.length ? `Appointment saved. Note: it overlaps ${overlapping[0].title}${overlapping.length>1?' and '+(overlapping.length-1)+' more':''}.` : 'Appointment saved.', overlapping.length ? 'info':'ok');
  }catch(error){
    plans=plans.filter(item=>item.id!==event.id);
    showStatus('Could not save appointment: '+(error?.message||'storage unavailable'), 'error');
  }
};
// Briefing playback is independent of the currently visible tab.
// Progress advances only after a segment actually finishes speaking.
// If the browser fails to deliver speech boundary events, we resume from
// the beginning of the last unfinished segment rather than skipping content.
const briefingPlayer = (() => {
  let segments = [], position = 0, playing = false, generation = 0;
  let questionPending = false;
  const split = text => (String(text).match(/[^.!?]+(?:[.!?]+|$)/g) || [String(text)])
    .map(x => x.trim()).filter(Boolean).reduce((chunks, sentence) => {
      if (chunks.length && chunks[chunks.length-1].length + sentence.length < 175)
        chunks[chunks.length-1] += ' ' + sentence;
      else chunks.push(sentence);
      return chunks;
    }, []);
  // Only orb click or spoken commands control the briefing. No extra UI buttons.
  const note = document.createElement('small');
  note.setAttribute('role','status');
  note.style.display='block'; note.style.marginTop='5px';
  const target=$('playBriefing');
  if(target?.parentNode) target.insertAdjacentElement('afterend',note);
  function render(){
    note.textContent=!segments.length?'':playing?'Briefing playing — you can navigate elsewhere or interrupt it.':
      position>=segments.length?'Briefing finished. Replay whenever you like.':
      `Briefing paused at part ${position+1} of ${segments.length}.`;
  }
  const state = () => ({active:playing, available:!!segments.length, paused:!!segments.length&&!playing&&position<segments.length});
  function pause(){
    if (!playing) return;
    playing=false; generation++;
    voice.stopSpeaking(); render();
  }
  function speakPart(version){
    if(!playing || version!==generation) return;
    if(position>=segments.length){playing=false;render();return;}
    const part=segments[position];
    voice.speak(part,{onFinished:()=>{
      if(!playing || generation!==version)return;
      position++; render();
      speakPart(version);
    }});
  }
  function resume(){
    if(!segments.length)return false;
    if(position>=segments.length)position=0;
    if(playing)return true;
    voice.primeAudio(); voice.setEnabled(true);
    playing=true; const version=++generation;
    render(); speakPart(version);
    return true;
  }
  function start(text){
    if(playing)pause();
    segments=split(text);position=0;questionPending=false;
    render();resume();
  }
  function replay(){if(playing)pause(); position=0;resume();}
  function ask(text){
    if(!segments.length)return false;
    const q=String(text).trim();
    if(/^(?:resume|continue|carry on|go on|where (?:were|did) we (?:leave off|stop)|finish (?:the|my) briefing|continue (?:the|my) briefing)(?: please| with (?:the|my) briefing)?[.!?]*$/i.test(q)){
      resume();return 'Certainly. Continuing the briefing from where we stopped.';
    }
    if(/^(?:repeat|replay|restart|start over|from the beginning)(?: (?:the|my) briefing)?[.!?]*$/i.test(q)){
      replay();return 'Certainly. Starting the briefing again.';
    }
    if(/^(?:pause|hold on|stop)(?: (?:the|my) briefing)?[.!?]*$/i.test(q)){
      pause();return 'Briefing paused. Say resume briefing whenever you are ready.';
    }
    return false;
  }
  render();
  return {start,pause,resume,replay,ask,get active(){return playing;},get available(){return segments.length>0;},get position(){return position;}};
})();
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
  // Start Mac microphone on the *briefing button gesture*, if permission was already granted.
  // Safari may refuse concurrent recognition/synthesis; the orb always remains the fallback.
  if (!aurenIOS && capabilities.listen && !voice.microphoneActive) {
    voice.setInterruptionsEnabled(interruptToggle.checked);
    try { voice.startListening(); } catch (err) { console.warn('Optional briefing interruption unavailable',err); }
  }
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
  const intelligence=savedDayIntelligence(date,briefingScope);
  const briefingText = `${butlerGreeting()}. ${intelligence.spoken}${weather}`.replace(/(?:Would you like|Shall I|Do you want)[^.!?]*[?]/gi,'').trim();
  latestBriefingContext = { text: briefingText.slice(0, 1200), at: Date.now() };
  try { sessionStorage.setItem('auren_latest_briefing_v213',JSON.stringify(latestBriefingContext)); } catch {}
  await addMessage('auren', briefingText, {silent:true});
  briefingPlayer.start(briefingText);
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
// Route natural requests to the *local AUREN planner* before general AI.
// No event is saved until the user has confirmed the proposed action.
function normalizedPlannerRequest(raw){
 const t=String(raw||'').trim();
 // Never treat ordinary mentions of leaving/going somewhere as save commands.
 if(/^(?:i (?:need|have|want|plan) to|i'm (?:going|heading)|we (?:need|have) to)\b/i.test(t))return null;
 const lead=t.match(/^(?:(?:hey\s+)?auren[,! ]*)?(?:(?:can|could|would|will) you\s+|i(?:'d| would) like (?:you )?to\s+|please\s+)(.*)$/i);
 const cleaned=(lead?lead[1]:t).replace(/[?.!]+$/,'').trim();
 // Common ways of asking to put a new appointment on the calendar.
 if(/^(?:put|add|schedule|book|create|set up|plan|move|change|reschedule|remove|delete|cancel)\b/i.test(cleaned))return cleaned;
 const alternative=cleaned.match(/^(?:make|set)\s+(?:me\s+)?(?:an?\s+)?(?:appointment|event|plan)\s+(?:for\s+)?(.+)$/i);
 if(alternative)return 'schedule '+alternative[1];
 const record=cleaned.match(/^(?:put|write|mark)\s+(.+?)\s+(?:on|in|into)\s+(?:my\s+)?(?:calendar|schedule|planner)$/i);
 if(record)return 'schedule '+record[1];
 const ask=cleaned.match(/^(?:can you|could you)\s+(?:put|add|schedule|book|create)\s+(.+)$/i);
 if(ask)return 'schedule '+ask[1];
 return null;
}
function plannerCapabilityReply(t){
 if(/^(?:can you|could you|are you able to|do you know how to)\s+(?:add|edit|change|move|reschedule|remove|delete|manage|update)\s+(?:my\s+|an?\s+|the\s+)?(?:appointments?|events?|schedule|calendar|plans?)\??[.!]*$/i.test(t.trim()))
  return 'Yes. I can add, move, and remove appointments in the AUREN calendar after your confirmation. I cannot change other calendar apps without a separate connection.';
 return null;
}
async function planSpeech(text){
 const raw=String(text||'').trim();
 const capability=plannerCapabilityReply(raw);
 if(capability)return capability;
 // Treat 'schedule me' as a request to create an appointment for the signed-in user.
 // This never saves anything until the regular planner confirmation is accepted.
 const scheduleForMe = raw.match(/^(?:(?:hey\s+)?auren[,! ]*)?(?:(?:can|could|would|will) you\s+|please\s+)?(?:schedule|book|put|add)\s+me\s*(?:for\s+)?(.*)$/i);
 if (scheduleForMe && !scheduleForMe[1].trim()) {
   planClarification = {kind:'subject'};
   return 'Certainly. What would you like me to schedule you for, and what day and time?';
 }
 const normalized=normalizedPlannerRequest(raw);
 let t=scheduleForMe ? 'schedule '+scheduleForMe[1].trim() : (normalized||raw);
 if (planClarification?.kind === 'subject') {
   if (/^(?:cancel|never mind|not now|no thanks)\b/i.test(raw)) {planClarification=null;return 'No appointment has been scheduled.';}
   if (!/^(?:schedule|book|add|put|plan)\b/i.test(t)) t='schedule '+raw;
   planClarification=null;
 }
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
 // v2.36: A correction to a pending addition/move always edits the draft,
 // never creates a second event and never silently commits a calendar change.
 if(pendingPlan && pendingPlan.kind!=='delete' && /^(?:actually[, ]*|instead[, ]*|no[, ]+(?:make|move|change)(?: it| that)?(?: to)?\s+|(?:make|change) (?:it|that) (?:for|to)\s+|(?:how|what) about\s+)(?:tomorrow|today|the day after tomorrow|next |this |on |at |\d)/i.test(t)){
   const newDate=parseDateIntent(t);
   const newTime=timeFromText(t) || extractLooseTime(t);
   if(newTime==='ambiguous')return 'Would that be AM or PM?';
   if(!newDate && !newTime)return 'Which day or time would you prefer?';
   if(newDate)pendingPlan.date=newDate;
   if(newTime)pendingPlan.time=newTime;
   pendingPlan.suggestedTime=null;
   pendingPlan.conflictAcknowledged=false;
   const warning=conflictAdvice(pendingPlan);
   return warning||`Certainly. Shall I ${changeDescription(pendingPlan)}? Nothing has been saved yet.`;
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
  if(p.kind==='add'){if(!p.title||!p.time)return 'I still need the name and time before saving that.';const event={id:uid(),title:p.title.slice(0,120),date:p.date,time:p.time,duration:p.duration||60};plans.push(event);try{savePlans();}catch(e){plans=plans.filter(x=>x.id!==event.id);return 'I could not save that event on this device.';}lastDiscussedPlanId=event.id;renderDay();const saved=`I've added ${event.title} for ${readableDate(event.date)} at ${formatClock(event.time)} (${localTimeZone()}).`;if(combinedReminder!==null){return saved+' '+eventReminder(event,combinedReminder);}prepareCalendarOffer('appointment',event);return saved+calendarOfferPrompt();}
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
 // v2.36: A clearly phrased follow-up correction to the last saved event.
 // An unrelated "actually, tomorrow" is intentionally not interpreted as a calendar edit.
 const correction=t.match(/^(?:actually[, ]*|wait[, ]*)(?:move|change|reschedule) (?:that|it|the appointment|the meeting) (?:to|for) (.+)$/i);
 if(correction && lastDiscussedPlanId && !pendingPlan){
   const previous=plans.find(p=>p.id===lastDiscussedPlanId);
   if(!previous)return 'Which saved appointment would you like to change?';
   const nextDate=parseDateIntent(correction[1]);
   const nextTime=timeFromText('at '+correction[1].replace(/^at\s+/i,''));
   if(nextTime==='ambiguous')return 'Would that be AM or PM?';
   if(!nextDate && !nextTime)return 'What new date or time should I use?';
   pendingPlan={kind:'move',id:previous.id,title:previous.title,date:nextDate||previous.date,time:nextTime||previous.time,duration:previous.duration};
   return conflictAdvice(pendingPlan)||`Shall I move ${previous.title} to ${readableDate(pendingPlan.date)} at ${formatClock(pendingPlan.time)}? I have not changed it yet.`;
 }
 if(/\b(?:move|change|reschedule)\b/i.test(t)){const time=timeFromText(t);const event=findMatchingEvent(t);if(!event)return 'Which event would you like me to change?';if(time==='ambiguous')return 'Did you mean AM or PM? Please include that when giving the new time.';const explicitDate=!!parseDateIntent(t);if(!time&&!explicitDate){planClarification={kind:'move-when',plan:{kind:'move',id:event.id,title:event.title,date:event.date,time:event.time,duration:event.duration}};lastDiscussedPlanId=event.id;return `Certainly. Which day or time should I move ${event.title} to?`;}pendingPlan={kind:'move',id:event.id,time:time||event.time,date:explicitDate?proposedDay(t):event.date,duration:/\b\d+\s*(?:hours?|minutes?)\b/i.test(t)?durationFromText(t):event.duration};lastDiscussedPlanId=event.id;return conflictAdvice(pendingPlan)||`Shall I move ${event.title} to ${formatClock(pendingPlan.time)} on ${readableDate(pendingPlan.date)}?`;}
 return null;
}
// The planner only changes data after confirmation, not from arbitrary AI text.
renderDay();document.body.dataset.screen='chat';refreshUpNext();checkReminders();

// Conversation replay remains anchored to what AUREN actually said last, not
// the planner, the projects database or an unrelated AI guess.
let lastSubstantiveReply = '';
const REPEAT_LAST_REPLY = /^(?:(?:can|could|would|will) you (?:please )?|please )?(?:repeat (?:that|it|yourself|what you (?:just )?said|the last (?:thing|part)|your last (?:answer|response))|say (?:that|it) again|tell me (?:that|it) again|what did you (?:just )?say|what was (?:that|your last (?:answer|response)))(?: please)?[.!?]*$/i;
function rememberLastReply(text) {
  const value=String(text||'').trim();
  if(value && value !== lastSubstantiveReply) lastSubstantiveReply=value;
}
// v2.16.2 — reliable access to Text Chat & History from the home screen.
const chatHistoryShortcut=document.createElement('button');
chatHistoryShortcut.type='button';
chatHistoryShortcut.id='aurenOpenChatHistory';
chatHistoryShortcut.textContent='Text chat & history';
chatHistoryShortcut.className='ghost';
chatHistoryShortcut.style.cssText='display:block;margin:14px auto;padding:10px 18px;border:1px solid rgba(199,168,104,.45);border-radius:12px;color:#e8d9bd;background:#22252b;';
const shortcutHost=document.querySelector('.home-shortcuts') || orbButton;
shortcutHost.insertAdjacentElement('afterend',chatHistoryShortcut);
chatHistoryShortcut.addEventListener('click',async()=>{
  await activateScreen('chat');
  const details=$('conversationDetails');
  if(details){details.open=true;details.hidden=false;details.style.display='block';details.scrollIntoView({behavior:'smooth',block:'start'});}
  const field=$('chatInput');
  if(field)field.focus({preventScroll:true});
});
// Remind users when local chat-history saving is disabled, without changing their privacy setting.
const historyDetails=$('conversationDetails');
if(historyDetails){
  const historyHelp=document.createElement('p');
  historyHelp.className='hint';historyHelp.id='aurenHistorySaveHint';
  historyHelp.textContent=settings.saveHistory?'Saved history on this browser is enabled.':'History saving is OFF in Settings. Current chat still works, but messages may not remain after refreshing.';
  historyDetails.insertBefore(historyHelp,historyDetails.querySelector('#log'));
  $('saveHistory')?.addEventListener('change',()=>{historyHelp.textContent=$('saveHistory').checked?'Saved history on this browser is enabled.':'History saving is OFF in Settings. Current chat still works, but messages may not remain after refreshing.';});
}

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
  // Replies appear in the separate live panel and chat log, not the upcoming-events ticker.
  if(rec.role==='auren' && !voice.speaking) { const first=String(rec.text||'').match(/[^.!?\n]+(?:[.!?]+|$)/)?.[0]?.trim()||rec.text; showCaption(first,'AUREN'); }
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
  if (role === 'auren') rec.text = personalizeMeetingText(rec.text);
  if (role === 'auren' && !opts.err && !opts.replay) rememberLastReply(rec.text);
  drawMessage(rec, opts);
  if (role === 'auren' && !opts.err && !opts.silent) voice.speak(rec.text);
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
  const all=safePersonalMemories(await Mem.listMemories());
  const relevant=relevantPersonalMemories(question,all,8);
  // Stable preferences go to AI only when clearly relevant to the question.
  // Otherwise, avoid stuffing unrelated memories into every reply.
  return {
    memories:relevant,
    session:butler.listSession().map(n=>n.text).slice(0,5)
  };
}

// v2.44 — Stable personal facts are read ONLY from local, user-saved records.
// These are not inferred from conversation history or silently written to permanent memory.
function safePersonalMemories(all){
 return all.filter(m=>{
  if(!m || !m.text || m.sensitive)return false;
  const scan=classify([m.text,...(m.tags||[])].join(' '));
  return !scan.blocked.length && !scan.sensitive.length;
 });
}
// Contextual relevance uses local word normalization and a few transparent topic groups.
// No AI inference, automatic saving, or unrelated memories sent with every question.
const AUREN_TOPIC_GROUPS={
  music:['music','song','songs','beat','beats','production','producing','instrument','instruments','garageband','fl','studio','guitar','mixing'],
  cars:['car','cars','vehicle','vehicles','driving','gti','volkswagen','jeep','engine','turbo','detailing'],
  coding:['code','coding','programming','app','website','web','javascript','software','developing','development'],
  study:['school','class','classes','study','studying','homework','assignment','assignments','exam','exams','college'],
  work:['business','work','working','client','clients','editing','agency','project','projects','career'],
  fitness:['fitness','gym','exercise','exercising','workout','workouts','training'],
  food:['food','foods','eat','eating','restaurant','restaurants','cooking','meal','meals'],
  schedules:['schedule','scheduling','calendar','meeting','meetings','routine','routines','reminder','reminders','task','tasks']
};
function normalizeMemoryWord(word){
 let w=String(word||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 if(w.length>5&&w.endsWith('ing'))w=w.slice(0,-3);
 else if(w.length>4&&w.endsWith('ies'))w=w.slice(0,-3)+'y';
 else if(w.length>4&&w.endsWith('s')&&!w.endsWith('ss'))w=w.slice(0,-1);
 return w;
}
function memoryTerms(text){return new Set(Mem.tokenize(String(text||'')).map(normalizeMemoryWord).filter(x=>x.length>2));}
function memoryTopicSet(text){
 const words=memoryTerms(text), topics=new Set();
 for(const [topic,terms] of Object.entries(AUREN_TOPIC_GROUPS))if(terms.some(term=>words.has(normalizeMemoryWord(term))))topics.add(topic);
 return topics;
}
function effectiveMemoryQuery(question){
 const raw=String(question||'').trim();
 const anchor=readConversationAnchor();
 // Only inherit the topic when the user clearly references the previous discussion.
 // Explicit new topics use their own words and do not drag previous preferences along.
 return conversationalReference(raw)&&anchor ? `${anchor.question} ${raw}` : raw;
}
function relevantPersonalMemories(question,memories,limit=8){
 const input=String(question||'').trim();
 const queryText=effectiveMemoryQuery(input);
 const queryTerms=memoryTerms(queryText);
 const queryTopics=memoryTopicSet(queryText);
 const directRecall=/\b(?:what (?:do you|can you) (?:know|remember) about me|my (?:saved )?(?:preferences|interests|goals|routines|memories)|saved about myself|remember about me)\b/i.test(input);
 const categoryRequested=/\bpreferences?\b/i.test(input)?'preference':/\binterests?\b/i.test(input)?'interest':/\bgoals?\b/i.test(input)?'goal':/\broutines?\b/i.test(input)?'routine':null;
 const stop=new Set(['what','when','where','who','why','how','that','this','with','about','could','would','should','more','tell','please','your','mine','have','from','been','does','into','like','want','need','good','best','help','make','find','give','know','there','the','and','for','are','you','my','me']);
 const meaningful=[...queryTerms].filter(w=>!stop.has(w));
 return memories.map((m,index)=>{
   const words=memoryTerms([m.text,...(m.tags||[])].join(' '));
   const overlap=meaningful.filter(word=>words.has(word)).length;
   const topics=memoryTopicSet([m.text,...(m.tags||[])].join(' '));
   const topicMatch=[...queryTopics].some(topic=>topics.has(topic));
   let score=overlap*5+(topicMatch?7:0);
   if(directRecall)score+=categoryRequested?(m.category===categoryRequested?12:0):4;
   // For ordinary questions, a memory must match a meaningful keyword or topic.
   if(!directRecall&&!overlap&&!topicMatch)score=0;
   if(categoryRequested&&directRecall&&m.category!==categoryRequested)score=0;
   return {m,index,score};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,Math.max(0,limit)).map(x=>x.m);
}

function userProfileAnswer(request,memories){
 const t=String(request||'').trim();
 if(!/^(?:(?:hey )?auren[, ]*)?(?:what (?:do you|can you) (?:know|remember) about me|tell me what you (?:know|remember) about me|what (?:are|is) my (?:saved )?(?:preferences|interests|goals|routines|memories)|list my saved (?:preferences|interests|goals|memories)|what have i (?:asked you to remember|saved about myself))[?.! ]*$/i.test(t))return null;
 const category=/preferences/i.test(t)?'preference':/interests/i.test(t)?'interest':/goals/i.test(t)?'goal':/routines/i.test(t)?'routine':null;
 const filtered=category?memories.filter(m=>m.category===category):memories;
 const chosen=filtered.slice(0,5);
 const identity=personalProfile.name?`Your saved name is ${personalProfile.name}. `:'';
 if(!chosen.length)return identity+'I don’t have any matching long-term memories saved on this device yet. You can add them in Memory.';
 const facts=chosen.map(m=>m.text.replace(/[.!?]+$/,'')).join('; ');
 return identity+`From your saved memories: ${facts}. You can review or correct them in Memory.`;
}
async function directPersonalRecall(request){
 const raw=String(request||'');
 if(!/^(?:(?:hey )?auren[, ]*)?(?:what (?:do you|can you) (?:know|remember) about me|tell me what you (?:know|remember) about me|what (?:are|is) my (?:saved )?(?:preferences|interests|goals|routines|memories)|list my saved (?:preferences|interests|goals|memories)|what have i (?:asked you to remember|saved about myself))[?.! ]*$/i.test(raw.trim()))return null;
 refreshPersonalProfile();
 const all=safePersonalMemories(await Mem.listMemories());
 return userProfileAnswer(raw,all);
}

// v2.43 — Session-scoped conversational anchor, distinct from saved profile and planner.
// Avoid persisting inferred topics, and retire references on clear topic changes.
let conversationAnchor=null;
// Keep a small, session-only topic trail. This is NOT permanent memory, and is
// never sent to storage. Specific saved facts still come from Memory/Planner.
const conversationTrail=[];
const TRAIL_LIFETIME=25*60*1000;
const TRAIL_MAX=6;
function activeConversationTrail(){
 const now=Date.now();
 while(conversationTrail.length && now-conversationTrail[0].at>TRAIL_LIFETIME)conversationTrail.shift();
 return conversationTrail;
}
function recordConversationTrail(question,answer){
 const q=String(question||'').slice(0,230),a=String(answer||'').slice(0,350);
 if(!q||!a||classify(q+' '+a).sensitive.length||classify(q+' '+a).blocked.length)return;
 // Follow-ups extend the same topic; do not crowd out the trail with 'tell me more'.
 const previous=conversationTrail[conversationTrail.length-1];
 if(previous && conversationalReference(q)){
   previous.reply=a;previous.at=Date.now();return;
 }
 conversationTrail.push({question:q,reply:a,at:Date.now()});
 if(conversationTrail.length>TRAIL_MAX)conversationTrail.splice(0,conversationTrail.length-TRAIL_MAX);
}
const ANCHOR_LIFETIME=12*60*1000;
function conversationTopicChange(raw){
 const t=String(raw||'').trim().toLowerCase();
 return /^(?:let(?:'s| us) (?:change|switch) (?:the )?(?:topic|subject)|(?:change|switch) (?:the )?(?:topic|subject)|new topic|something (?:else|different)|forget (?:that|the previous topic)|never mind(?: about that)?|start (?:a )?new conversation)[.!? ]*$/.test(t);
}
// v2.49: A fresh subject should not inherit the previous discussion merely
// because the user did not say the exact phrase "change the subject".
// This is a local routing hint, never a long-term memory write.
function aurenTopicShift(raw){
 const t=String(raw||'').trim();
 const explicit=t.match(/^(?:(?:let(?:'s| us)|can we|could we|i(?:'d| would) (?:like|prefer) to|i want to)\s+)?(?:talk|chat|speak|discuss)\s+(?:about\s+)?(.{2,110}?)\s+(?:instead|now)[.!?]*$/i)
   || t.match(/^(?:let(?:'s| us)\s+)?(?:switch|move|change)\s+(?:over\s+)?to\s+(.{2,110}?)[.!?]*$/i)
   || t.match(/^(?:actually[,]?\s+)?(?:let(?:'s| us)\s+)?talk\s+about\s+(.{2,110}?)[.!?]*$/i);
 if(explicit){
   const topic=explicit[1].trim().replace(/[.!?]+$/,'');
   if(!/^(?:that|it|this|the same|the previous|something|anything|more)$/i.test(topic))
     return {changed:true,question:`Tell me about ${topic}.`};
 }
 // When two questions have clearly different concrete domains, retire the
 // old anchor. A broad pronoun follow-up or task command must not cause a switch.
 const old=readConversationAnchor();
 if(!old||conversationalReference(t)||t.length<12)return {changed:false,question:t};
 if(/^(?:yes|no|okay|thanks|thank you|and |but |what about that|why|how does that|tell me more)/i.test(t))return {changed:false,question:t};
 const earlier=memoryTopicSet(old.question), incoming=memoryTopicSet(t);
 if(earlier.size && incoming.size && ![...incoming].some(x=>earlier.has(x)))return {changed:true,question:t};
 return {changed:false,question:t};
}
function aurenRetireConversationTopic(){
 conversationAnchor=null;
 conversationTrail.length=0;
 conversationCorrection=null;
 // The last few assistant turns were about the previous subject. Preserve
 // the user's visible History, but do not send that stale topic to the AI.
 aiRecent.length=0;
 try{localStorage.removeItem(CONVERSATION_KEY);}catch{}
}
function conversationalReference(raw){
 const t=String(raw||'').trim();
 return /^(?:what about (?:that|it|the same thing)|tell me more(?: about (?:that|it))?|could you go (?:a bit )?deeper|can you say more|can you (?:explain|expand on|clarify) (?:that|it)|why (?:is that|did you say that)|what did you mean(?: by that)?|how (?:does|would) that work|and (?:then|after that)|what happens next|could you explain further|give me (?:more )?details(?: about (?:that|it))?)[.!? ]*$/i.test(t);
}
function readConversationAnchor(){
 return conversationAnchor && Date.now()-conversationAnchor.at<ANCHOR_LIFETIME ? conversationAnchor : null;
}
function trackConversationAnchor(question,answer){
 if(conversationTopicChange(question)){conversationAnchor=null;return;}
 const scan=classify(question+' '+answer);
 if(scan.blocked.length||scan.sensitive.length){conversationAnchor=null;conversationTrail.length=0;return;}
 const prior=readConversationAnchor();
 conversationAnchor={at:Date.now(), question: conversationalReference(question)&&prior?prior.question:String(question).slice(0,280), reply:String(answer).slice(0,750)};
 recordConversationTrail(question,answer);
}
// v2.47 — Retry only plain information questions after a failed AI response.
// Never retry commands that can change calendars, memories, tasks, privacy or location.
let lastFailedAIQuestion=null;
const RETRY_WINDOW_MS=5*60*1000;
const RETRY_INTENT=/^(?:(?:please |can you |could you )?)(?:try (?:that|it|the answer|my question) again|retry(?: that| the answer| my question)?|answer (?:that|my question) again|you cut out|that didn't load|the reply failed)[.!? ]*$/i;
function retryableInfoQuestion(value){
 const t=String(value||'').trim();
 if(t.length<3||t.length>400)return false;
 if(classify(t).blocked.length||classify(t).sensitive.length)return false;
 if(/\b(?:password|token|key|secret|account number|credit card)\b/i.test(t))return false;
 if(/^(?:add|save|remember|forget|delete|remove|clear|wipe|schedule|book|move|reschedule|cancel|set|create|start|stop|enable|disable|turn|send|take me|navigate|directions|find|search|open|remind|mark|complete|finished|done|confirm|yes|no|call me|change|update|edit)\b/i.test(t))return false;
 return true;
}
function rememberFailedAIQuestion(question){
 lastFailedAIQuestion=retryableInfoQuestion(question)?{question:String(question).trim(),at:Date.now()}:null;
}
function takeRetryableQuestion(){
 const entry=lastFailedAIQuestion;
 lastFailedAIQuestion=null;
 return entry&&Date.now()-entry.at<RETRY_WINDOW_MS?entry.question:null;
}
// v2.46 — Distinguish conversational correction from a saved-memory dispute.
// Never change a saved fact or calendar item through this conversational path.
let conversationCorrection=null;
function parseConversationCorrection(raw){
 const t=String(raw||'').trim();
 const m=t.match(/^(?:(?:no[,! ]+)?(?:i (?:actually )?meant|what i meant (?:was|is)|i was (?:talking|asking) about|rather|instead|sorry[, ]+i meant)|(?:no[,! ]+)?(?:not that|that's not what i meant)[,.:; ]+(?:i meant|i mean|i was asking about)?)\s+(.{2,240})[.!?]*$/i);
 if(m)return m[1].trim();
 if(/^(?:no[,! ]+)?(?:that's not what i meant|you misunderstood(?: me)?|not what i asked|that's not what i was asking)(?:[.!? ]*)$/i.test(t))return '';
 return null;
}
function freshConversationReference(){
 const a=readConversationAnchor();
 if(a)return a;
 if(lastSubstantiveReply)return {question:'the last question',reply:lastSubstantiveReply.slice(0,650),at:Date.now()};
 return null;
}
function correctionContext(question){
 if(!conversationCorrection || Date.now()-conversationCorrection.at>3*60*1000)return '';
 const c=conversationCorrection;
 conversationCorrection=null;
 return `The user is CORRECTING your last answer, not asking you to edit stored memories. Their intended request is ${JSON.stringify(question)}. The previous context was ${JSON.stringify(c.question)} and previous response ${JSON.stringify(c.reply)}. Address the corrected subject directly; do not repeat the same answer, ask for the topic again, or claim to have changed records.`;
}
// v2.45 — Response style belongs to the current request, not a permanent profile fact.
// Recognize direct verbosity requests without hard-coding answers or changing saved data.
function aurenResponseStyle(question){
 const t=String(question||'').trim();
 if(/\b(?:in detail|detailed(?:ly)?|step.by.step|walk me through|full explanation|explain (?:it |that )?thoroughly|go deeper|elaborate|give me (?:more|the full) details)\b/i.test(t))return 'detailed';
 if(/\b(?:short answer|briefly|keep it short|quick answer|one sentence|just the answer|be concise|simple answer|no explanation|summari[sz]e briefly)\b/i.test(t))return 'brief';
 if(/^(?:what(?:'s| is) (?:the )?(?:time|date)|what time is it|what day is it|yes|no|okay|ok|thanks|thank you|got it|understood|alright)[?.! ]*$/i.test(t))return 'brief';
 if(/^(?:can you|could you|would you|please )?(?:explain|teach|compare|analy[sz]e|help me understand|how does|why does|why is)\b/i.test(t))return 'balanced';
 return 'natural';
}
function aurenStyleGuidance(question){
 const style=aurenResponseStyle(question);
 const core='Speak like a calm capable British-style butler, not a customer-service chatbot. Answer the request first, with natural wording. Never pad a reply with repeated greetings, formal titles, generic offers, or apologies. Never end every answer with a question. Avoid repeated lists of capabilities and unnecessary disclaimers. If the request requires a UI action, use the available local action rather than describing imagined actions.';
 if(style==='brief')return core+' This turn explicitly needs a SHORT response: ordinarily one sentence, at most two. No intro, list or follow-up offer.';
 if(style==='detailed')return core+' This turn asks for a thorough explanation. Give useful specifics and ordered steps only when they improve clarity; do not sacrifice completeness for brevity.';
 if(style==='balanced')return core+' Explain the essential reasoning clearly, with an example only if useful. Normally 2-5 sentences unless complexity warrants more.';
 return core+' Default to a compact, friendly answer of 1-3 sentences for straightforward matters. Give more detail for genuinely complex requests. Ask one clarifying question only if the missing information prevents progress.';
}

async function askWithMemory(question) {
  refreshPersonalProfile();
  const context = await contextForAI(question);
  const anchored=readConversationAnchor();
  const followup=conversationalReference(question);
  // Read live local state, not a stale snapshot of the planner.
  const today = localDate();
  const upcoming = plans.filter(p => p.date >= today)
    .sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .slice(0, 12)
    .map(p => `${p.title.slice(0,90)} | ${p.date} ${p.time} | ${p.duration||60} min`);
  const due = reminders.filter(r => !r.fired && new Date(r.at).getTime() >= Date.now())
    .sort((a,b) => a.at.localeCompare(b.at))
    .slice(0, 8).map(r => `${r.text.slice(0,90)} | ${r.at}`);
  const projects = (await Proj.listProjects()).filter(p => !p.sensitive)
    .slice(0, 8).map(p => `${p.name.slice(0,90)} | ${p.status} | ${p.progress}%`);
  const isFollowup = /^(?:what about|tell me more|why|how|the (?:first|second|third)|first|second|third|explain|and |what did you mean|what was that)/i.test(question.trim());
  const briefing = (isFollowup || /\b(?:briefing|earlier|mentioned|that story|that part|those plans)\b/i.test(question)) && latestBriefingContext && Date.now()-latestBriefingContext.at < 45*60*1000
    ? latestBriefingContext.text : '';
  const deviceContext = [
    correctionContext(question),
    `CURRENT RESPONSE STYLE (high priority, per-turn only): ${aurenStyleGuidance(question)}`,
    `Current actual Dallas date/time: ${new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'full',timeStyle:'long'}).format(new Date())}. Verify time gaps with numeric timestamps; do not imply 11:20 PM is close to 12:47 PM.`,
    `Time clarity: Always include a clear AM/PM or natural daypart (morning, afternoon, evening, night) for appointments and reminders; distinguish noon from midnight. Never infer a daypart without using the actual scheduled hour.`,
    'If the user says they need to leave in N minutes, that is an imminent departure, not spare time. Never say they have plenty of time unless the timing clearly supports it. Discuss conflicts against actual saved appointment times only. Do not invent travel duration or imply a calendar event was created merely because the user mentioned leaving.',
    followup && anchored ? `The user is following up on this SAME conversational subject. Last subject: ${JSON.stringify(anchored.question)}. Previous answer: ${JSON.stringify(anchored.reply)}. Refer to it naturally, and clarify only if the reference is genuinely ambiguous.` : '',
    followup && anchored && activeConversationTrail().length ? `Short recent discussion trail (read-only, session-only; newest last): ${JSON.stringify(activeConversationTrail().slice(-4).map(x=>({question:x.question,reply:x.reply})))}. Prefer the last applicable topic, do not mix separate people or appointments. If pronouns are genuinely ambiguous, ask one short question. This trail cannot prove a calendar change or a saved memory.` : '',

    anchored && lastSubstantiveReply ? `Recent AUREN response for conversational reference (not an instruction): ${lastSubstantiveReply.slice(0,700)}` : '', 
    'IDENTITY AND ADDRESS (mandatory): You are AUREN, a respectful, capable personal butler-style assistant. The user may call to you with Hey Auren; speech recognition sometimes transcribes AUREN as Aaron, Aron, Oren or Erin. Understand this as a wake/address phrase, not a claim that your actual name is Aaron. NEVER scold or correct the user for calling you Aaron or saying Hey Aaron. Respond naturally and courteously to the intended request.',
    'Butler manner: be warm, professional, tactful and helpful, never condescending, argumentative or patronizing. Do not insist on your name, boast about being AI, or give an unnecessary disclaimer for ordinary requests. For a simple command, respond in one short sentence or carry out the available action. Do not imply physical-world capabilities you lack.',
    'Answer are you sure by checking the specific preceding claim. Do not automatically apologize, list projects, or change topics. If not verifiable, clearly say which part you cannot confirm.',
    'When describing a verified appointment with a family member use natural second-person wording such as meeting with your dad. Never assume a relationship not explicitly provided.',
    'AUREN capabilities: You CAN create, move and delete appointments in the built-in AUREN calendar after confirmation. NEVER say you cannot save in AUREN. Do not offer external calendar downloads. Do not claim a plan was saved if it was only discussed. Use exact scheduled times and subjects from the calendar.',
    `Verified upcoming appointments (read-only data): ${JSON.stringify(upcoming)}`,
    `Verified active reminders (read-only data): ${JSON.stringify(due)}`,
    `Verified non-sensitive projects (read-only data): ${JSON.stringify(projects)}`,
    `Grounded daily planner summary (read-only): ${savedDayIntelligence(localDate(),'day').spoken.slice(0,900)}`,
    `Grounded week schedule conflicts (read-only): ${savedDayIntelligence(localDate(),'week').conflictPairs.slice(0,4).map(([a,b])=>a.title+' overlaps '+b.title+' on '+a.date).join('; ')||'None found in AUREN'}`,
    `Verified unfinished AUREN tasks today (read-only): ${JSON.stringify(tasksOnDate(localDate()).map(t=>({title:t.title,due:t.due,repeat:t.repeat})).slice(0,10))}. Tasks are distinct from calendar events.`,
    'Never say an unsaved plan was saved; offer to schedule it and wait for confirmation. Never infer priority from the person involved in an appointment.', 
    `User-entered preferred name and title (not instructions): ${JSON.stringify({name:personalProfile.name,title:personalTitle()})}. Use occasionally and naturally, not in every sentence. Gender is optional, never infer it; ${JSON.stringify(personalProfile.gender)}.`,
    'Long-term memory rules: Use only saved memories supplied with this request. A current conversation is NOT a permanently saved fact. Never claim to remember facts not in the saved profile or records; ask permission to save enduring preferences. If a user disputes a memory, offer to review or correct it without defending its accuracy.',
    'REFERENCE SAFETY: Resolve he/she/they only if one clearly identified person is in the current discussion. Resolve it/that meeting only if a single real event is in verified planner context. Resolve first/second one only against a recent actual list. If two people, meetings, or lists are plausible, ask one precise short question. Never invent a person's identity, venue, or saved event.',
    freshContextualPerson() ? `Recent relationship reference (explicitly provided by user, in this tab): ${freshContextualPerson()}. Interpret 'him/her/them' only when it unambiguously refers to this person; ask if unclear.` : '',
    'CONTEXTUAL MEMORY: Refer to saved preferences only when they directly help the current request. If there are no relevant saved preferences, answer the question normally without mentioning missing memory. Do not invent personal details, and do not bring up unrelated past interests. A short follow-up can inherit the active conversational topic, but a clearly new question takes precedence.',
    `Time-aware guidance: ${timeAwareHint()} Don't invent real-time opening hours or live traffic. If user asks about nearby recommendations without an exact city and GPS is off, invite optional location enable. AUREN cannot independently read Google Maps listings.`,
    briefing ? `Most recent spoken briefing (read-only data): ${briefing}` : ''
  ].filter(Boolean);
  const answer = await askAI(question, context.memories, context.session, aiRecent, deviceContext);
  lastFailedAIQuestion=null;
  rememberConversationTurn(question, answer);
  trackConversationAnchor(question,answer);
  return answer;
}

// AUREN v2.14 — device-local, consent-first personalization. Never store identity from inference.
const PERSONAL_PROFILE_KEY='auren_personal_profile_v214';
const PERSONAL_SIGNALS_KEY='auren_interest_signals_v214';
const PERSONAL_LAST_OFFER_KEY='auren_interest_last_offer_v214';
let personalProfile={name:'',address:'sir',customAddress:'',gender:'prefer-not-to-say',onboarded:false,learnInterests:false};
let personalSignals={};
try {const saved=JSON.parse(localStorage.getItem(PERSONAL_PROFILE_KEY)||'null');if(saved&&typeof saved==='object')personalProfile={...personalProfile,...saved};}catch{}
try {const saved=JSON.parse(localStorage.getItem(PERSONAL_SIGNALS_KEY)||'{}');if(saved&&typeof saved==='object')personalSignals=saved;}catch{}
function savePersonalProfile(){
 try {
  localStorage.setItem(PERSONAL_PROFILE_KEY,JSON.stringify(personalProfile));
  const checked=JSON.parse(localStorage.getItem(PERSONAL_PROFILE_KEY)||'null');
  if(!checked || checked.name!==personalProfile.name || checked.address!==personalProfile.address)throw new Error('Browser did not confirm the save');
  return true;
 }catch(error){showStatus('Your profile was not saved: '+error.message,'error');return false;}
}
function refreshPersonalProfile(){
 try {const saved=JSON.parse(localStorage.getItem(PERSONAL_PROFILE_KEY)||'null');if(saved&&typeof saved==='object')Object.assign(personalProfile,saved);}catch{}
}

function savePersonalSignals(){try{localStorage.setItem(PERSONAL_SIGNALS_KEY,JSON.stringify(personalSignals));}catch{}}
function preferredAddress(){const a=personalProfile.address;return a==='name'?personalProfile.name:a==='custom'?personalProfile.customAddress:a==='none'?'':a;}
function personalTitle(){const v=preferredAddress();return v?v.trim():'';}
const personalCard=document.createElement('section');personalCard.className='card';personalCard.id='aurenPersonalCard';
const personalHeading=document.createElement('h3');personalHeading.textContent='How AUREN addresses you';
const personalExplainer=document.createElement('p');personalExplainer.className='hint';personalExplainer.textContent='Choose a name and form of address. Optional gender is never guessed and does not determine your title. Saved on this browser; change whenever you like.';
const nameField=document.createElement('input');nameField.type='text';nameField.placeholder='What should AUREN call you?';nameField.maxLength=45;nameField.setAttribute('aria-label','Your preferred name');
const addressSelect=document.createElement('select');addressSelect.setAttribute('aria-label','Preferred form of address');
for(const [value,label] of [['sir','Sir'],['maam',"Ma’am"],['name','My name'],['none','No title'],['custom','Custom title']])addressSelect.append(new Option(label,value));
const customAddress=document.createElement('input');customAddress.type='text';customAddress.placeholder='Custom title';customAddress.maxLength=32;customAddress.setAttribute('aria-label','Custom form of address');
const genderSelect=document.createElement('select');genderSelect.setAttribute('aria-label','Optional gender');
for(const [value,label] of [['prefer-not-to-say','Prefer not to say'],['male','Male'],['female','Female'],['nonbinary','Nonbinary'],['other','Other']])genderSelect.append(new Option(label,value));
const learningRow=document.createElement('label');learningRow.className='check';
const learningCheck=document.createElement('input');learningCheck.type='checkbox';
learningRow.append(learningCheck,document.createTextNode(' Suggest interests for me to save after repeated mentions (ask before saving)'));
const personalSave=document.createElement('button');personalSave.textContent='Save how to address me';personalSave.type='button';
const personalNotice=document.createElement('p');personalNotice.className='hint';
function paintPersonal(){nameField.value=personalProfile.name||'';addressSelect.value=personalProfile.address||'sir';customAddress.value=personalProfile.customAddress||'';genderSelect.value=personalProfile.gender||'prefer-not-to-say';learningCheck.checked=!!personalProfile.learnInterests;customAddress.hidden=addressSelect.value!=='custom';}
addressSelect.onchange=()=>{customAddress.hidden=addressSelect.value!=='custom';};
personalSave.onclick=()=>{
 personalProfile.name=nameField.value.trim().slice(0,45);
 personalProfile.address=addressSelect.value;
 personalProfile.customAddress=customAddress.value.trim().slice(0,32);
 personalProfile.gender=genderSelect.value;
 personalProfile.learnInterests=learningCheck.checked;
 personalProfile.onboarded=true;
 const saved=savePersonalProfile();
 personalNotice.textContent=saved?`Saved and checked. ${personalProfile.name?`Your name is ${personalProfile.name}. `:''}I'll address you as ${personalTitle()||'you'}.`:'Could not save. Check Safari website storage settings.';
 if(saved)personalWelcome.hidden=true;
};
const personalClear=document.createElement('button');personalClear.type='button';personalClear.className='ghost';personalClear.textContent='Clear learned interests';
personalClear.onclick=()=>{personalSignals={};savePersonalSignals();personalNotice.textContent='Interest observations cleared. Saved memories are managed separately in Memory.';};
personalCard.append(personalHeading,personalExplainer,nameField,addressSelect,customAddress,genderSelect,learningRow,personalSave,personalClear,personalNotice);
$('settings').insertBefore(personalCard,$('settings').firstElementChild);paintPersonal();
// Compact profile: essential controls first; optional fields available on demand.
personalHeading.textContent='Your profile';
personalExplainer.textContent='Your name and how AUREN addresses you. Stored only in this browser.';
nameField.placeholder='Your name';
personalSave.textContent='Save profile';
const personalExtras=document.createElement('details');personalExtras.className='auren-profile-optional';
const extrasTitle=document.createElement('summary');extrasTitle.textContent='More personal preferences';personalExtras.append(extrasTitle,genderSelect,learningRow,personalClear);
personalCard.replaceChildren(personalHeading,personalExplainer,nameField,addressSelect,customAddress,personalSave,personalNotice,personalExtras);
personalCard.style.cssText='margin:10px auto;padding:18px;border:1px solid rgba(199,168,104,.32);border-radius:16px;';
const themeCard=document.createElement('section');themeCard.className='card';themeCard.id='aurenThemeSettings';
const themeHeading=document.createElement('h3');themeHeading.textContent='Appearance';
const themeHint=document.createElement('p');themeHint.className='hint';themeHint.textContent='Choose a look. Changes save automatically.';
const themePicker=document.createElement('select');themePicker.setAttribute('aria-label','AUREN appearance');
for(const [value,label] of [['classic','Classic gold'],['slate','Slate blue'],['emerald','Emerald'],['rose','Rose gold']])themePicker.append(new Option(label,value));
const themeStyle=document.createElement('style');themeStyle.textContent=`body[data-auren-theme="slate"]{--gold:#a5bde9;--accent:#a5bde9}body[data-auren-theme="emerald"]{--gold:#8fd7b8;--accent:#8fd7b8}body[data-auren-theme="rose"]{--gold:#e6b6a3;--accent:#e6b6a3}`;
document.head.append(themeStyle);
const THEME_KEY='auren_appearance_v226';
function applyAurenTheme(value){const theme=['classic','slate','emerald','rose'].includes(value)?value:'classic';document.body.dataset.aurenTheme=theme;themePicker.value=theme;try{localStorage.setItem(THEME_KEY,theme);}catch{}}
applyAurenTheme(localStorage.getItem(THEME_KEY)||'classic');
themePicker.onchange=()=>applyAurenTheme(themePicker.value);
themeCard.append(themeHeading,themeHint,themePicker);personalCard.insertAdjacentElement('afterend',themeCard);

const personalWelcome=document.createElement('div');personalWelcome.className='card';personalWelcome.id='aurenWelcome';personalWelcome.style.cssText='box-sizing:border-box;width:min(92%,680px);margin:12px auto;padding:14px;border:1px solid rgba(199,168,104,.55);border-radius:14px;background:#25262a;color:#f0dfbb;text-align:center;';
const welcomeText=document.createElement('p');welcomeText.textContent='Welcome to AUREN. What would you like me to call you? You may use your name, Sir, Ma’am, or any title. Gender is optional and never assumed.';
const welcomeSetup=document.createElement('button');welcomeSetup.type='button';welcomeSetup.textContent='Set my name and preferences';welcomeSetup.onclick=()=>{void activateScreen('settings');nameField.focus();};
const welcomeLater=document.createElement('button');welcomeLater.type='button';welcomeLater.className='ghost';welcomeLater.textContent='Maybe later';welcomeLater.onclick=()=>{personalProfile.onboarded=true;savePersonalProfile();personalWelcome.hidden=true;};
personalWelcome.append(welcomeText,welcomeSetup,welcomeLater);orbButton.insertAdjacentElement('afterend',personalWelcome);personalWelcome.hidden=!!personalProfile.onboarded;
function personalCommand(text){
 refreshPersonalProfile();
 const t=String(text||'').trim();let m;
 if((m=t.match(/^(?:please\s+)?(?:call me|start calling me|you can call me|my name is)\s+([\p{L}\p{N} .'_-]{1,45})[.!?]*$/iu))){
  const v=m[1].trim().replace(/[.!?]+$/,'');
  if(/^(?:sir|ma'am|ma’am|madam|mister|mr\.?|miss)$/i.test(v)){
   personalProfile.address=/^sir$/i.test(v)?'sir':/ma/i.test(v)?'maam':'custom';personalProfile.customAddress=v;
  }else{personalProfile.name=v;personalProfile.address='name';}
  personalProfile.onboarded=true;savePersonalProfile();paintPersonal();personalWelcome.hidden=true;
  return `Certainly. I'll call you ${v}. You can change this whenever you wish.`;
 }
 if((m=t.match(/^(?:change|switch|set|update)\s+(?:my\s+)?(?:gender|gender setting)\s+(?:to\s+)?(male|female|nonbinary|non-binary|other|prefer not to say)[.!?]*$/i))){
  personalProfile.gender=/prefer/i.test(m[1])?'prefer-not-to-say':/^non/i.test(m[1])?'nonbinary':m[1].toLowerCase();savePersonalProfile();paintPersonal();
  return 'Your optional gender setting is updated. Your preferred name and title stay unchanged unless you ask me to change them.';
 }
 if(/^(?:what(?:'s| is) my name|do you (?:know|remember) my name|who am i|tell me my name|what name (?:did i|have i) (?:give|saved|set)|what(?:'s| is) my nickname|what do you call me|what(?:'s| is) my preferred name|how should you address me)[?!. ]*$/i.test(t)){
  if(!personalProfile.name)return 'I do not have your name saved yet. You can enter it in Settings under Your profile.';
  return /nickname|what do you call me|address me/i.test(t)?`I call you ${personalTitle()||personalProfile.name}. Your saved name is ${personalProfile.name}.`:`Your name is ${personalProfile.name}.`;
 }
 if(/\b(?:stop learning my interests|turn (?:off|on) interest learning|stop suggesting memories|start learning my interests)\b/i.test(t)){
  personalProfile.learnInterests=/\b(?:start|on)\b/i.test(t);savePersonalProfile();paintPersonal();return personalProfile.learnInterests?'I can suggest interests after repeated mentions. I will ask before saving them.':'Interest learning suggestions are off.';
 }
 return null;
}
// Only conservative hobby keywords count as possible non-sensitive interests; no automatic memory write.
const INTEREST_CATEGORIES=[['music production',/\b(?:making music|producing music|producing beats|making beats|music production|garageband|fl studio)\b/i],['video editing',/\b(?:video editing|editing videos|capcut|making reels)\b/i],['cars',/\b(?:car meets?|car detailing|car photography|working on cars|my car)\b/i],['football',/\b(?:football practice|playing football|football games?)\b/i],['gaming',/\b(?:playing games|video games|game development|building a game)\b/i],['drawing',/\b(?:drawing|sketching|digital art)\b/i],['photography',/\b(?:photography|taking photos|photo editing)\b/i],['coding',/\b(?:coding|programming|building (?:an? )?(?:app|website))\b/i],['fitness',/\b(?:working out|gym routine|lifting weights|strength training)\b/i]];
let personalPendingInterest=null;
function observeInterest(t){
 if(!personalProfile.learnInterests||classify(t).sensitive.length||classify(t).blocked.length)return null;
 const found=INTEREST_CATEGORIES.find(([,regex])=>regex.test(t));if(!found)return null;
 const [interest]=found;const now=Date.now();const rec=personalSignals[interest]||{count:0,last:0,offered:0};
 if(now-rec.last>2*60*1000){rec.count=Math.min(10,rec.count+1);rec.last=now;}
 personalSignals[interest]=rec;savePersonalSignals();
 if(rec.count<3||now-rec.offered<30*86400000||personalPendingInterest)return null;
 rec.offered=now;savePersonalSignals();personalPendingInterest=interest;
 return `You've mentioned ${interest} a few times. Would you like me to remember it as an interest for future suggestions?`;
}
async function personalInterestConfirmation(t){
 if(!personalPendingInterest)return false;
 if(/^(?:yes|yeah|sure|save it|remember it|please do|go ahead)[.! ]*$/i.test(t)){
  const interest=personalPendingInterest;personalPendingInterest=null;
  try{await Mem.createMemory({text:`I am interested in ${interest}`,category:'interest',tags:[interest]});await addMessage('auren',`I've saved ${interest} as an interest. You can edit or delete it in Memory.`);}
  catch{await addMessage('auren',`I couldn't save that preference. You can add ${interest} manually in Memory.`);}
  return true;
 }
 if(/^(?:no|no thanks|not now|nah|skip)[.! ]*$/i.test(t)){personalPendingInterest=null;await addMessage('auren','Of course. I have not saved that interest.');return true;}
 personalPendingInterest=null;return false;
}
function timeAwareHint(){const h=new Date().getHours();return h<5?'It is late at night locally; do not suggest places as open without verification.':h<11?'It is morning locally; morning-appropriate options may be useful.':h<15?'It is midday locally; lunch or daytime activities may be useful.':h<18?'It is afternoon locally; prioritize the user’s actual schedule.':h<22?'It is evening locally; never assume venues are currently open.':'It is late evening locally; be considerate of tomorrow’s schedule and opening hours.';}
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
let butlerPreferences = { preferredWindow: 'any', suggestions: false };
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
let pendingWeatherOffer = null;
let lastWeatherDetails = null;
// v2.11.3 — explicit-location, respectful confirmations, and relationship-aware wording.
// Location stays in memory only. Browser permission is requested only by user action.
let aurenLocation = null;
let locationApproved = false;
let lastAssurance = '';
// AUREN v2.14: location is OFF by default, only used after permission.
let locationRequestSequence = 0;
let locationPending = false;
let pendingLocationIntent = null;
const locationPanel = document.createElement('div');
locationPanel.className='card';
const locationTitle=document.createElement('h3');locationTitle.textContent='Location privacy';
const locationDesc=document.createElement('p');locationDesc.className='hint';
locationDesc.textContent='OFF by default. One-time GPS requests only. Coordinates stay in this tab memory and are never sent to AUREN AI or saved. Maps opened by you follow their own privacy policies.';
const locationButton=document.createElement('button');locationButton.type='button';
const locationStatus=document.createElement('p');locationStatus.className='hint';
function locationPaint(){
 // Only update controls that exist in Settings. No deleted Home-screen controls.
 const active=locationApproved||locationPending;
 locationButton.textContent=active?'Turn location OFF':'Turn location ON';
 locationButton.setAttribute('aria-pressed',String(active));
 locationStatus.textContent=locationPending?'Waiting for Safari permission…':locationApproved?'Location ON for this tab. Turn it OFF whenever you like.':'Location OFF. No coordinates being held.';



 if(locationApproved) locationPermissionBar.hidden=true;
}
function locationOff(){
 locationRequestSequence++;locationApproved=false;locationPending=false;aurenLocation=null;pendingLocationIntent=null;
 locationPermissionBar.hidden=true;nearbyResultPanel.hidden=true;nearbyResultLink.removeAttribute('href');aurenPlaces.clear();locationPaint();
}
function nearbySearchTerm(request){
 const t=String(request||'').trim();
 if(/\b(?:restaurant|food|eat|dinner|lunch|breakfast|brunch|cafe|coffee)\b/i.test(t))return 'restaurants';
 if(/\b(?:park|outdoors|nature|hike)\b/i.test(t))return 'parks';
 if(/\b(?:shopping|mall|shop|store)\b/i.test(t))return 'shopping';
 if(/\b(?:gas station|fuel)\b/i.test(t))return 'gas stations';
 if(/\b(?:movie|cinema)\b/i.test(t))return 'movie theaters';
 if(/\b(?:where should i go|where can i go|something to do|things to do|places to visit)\b/i.test(t))return 'things to do';
 return t.replace(/\b(?:near me|nearby|near where i am|around me|closest to me)\b/gi,'').replace(/[^a-z0-9 ,'-]/gi,' ').trim().slice(0,85)||'places to visit';
}
function showNearbyResults(request){
 if(!locationApproved||!aurenLocation){offerLocationButton();return;}
 const term=nearbySearchTerm(request);
 const lat=aurenLocation.latitude.toFixed(5), lon=aurenLocation.longitude.toFixed(5);
 // Coordinates go ONLY to Maps following an explicit click; not to AUREN AI.
 const params=new URLSearchParams({api:'1',query:`${term} near ${lat}, ${lon}`});
 nearbyResultLink.href='https://www.google.com/maps/search/?'+params.toString();
 nearbyResultLink.textContent='View '+term+' near me in Maps';
 nearbyResultNote.textContent='Your location is ON. Open Maps to see nearby results. Your coordinates are shared with Google Maps only if you click this link. AUREN itself does not have a live places database.';
 nearbyResultPanel.hidden=false;
 nearbyResultPanel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function locationOn(){
 if(locationApproved&&aurenLocation){locationPaint();if(pendingLocationIntent){const request=pendingLocationIntent;pendingLocationIntent=null;showNearbyResults(request);}return true;}
 if(locationPending)return true;
 if(!navigator.geolocation){locationStatus.textContent='Location is unavailable in this browser.';locationPermissionHint.textContent=locationStatus.textContent;locationPermissionBar.hidden=false;return false;}
 const id=++locationRequestSequence;locationPending=true;locationPermissionBar.hidden=true;locationPaint();
 navigator.geolocation.getCurrentPosition(pos=>{
  if(id!==locationRequestSequence)return;
  locationPending=false;locationApproved=true;
  aurenLocation={latitude:pos.coords.latitude,longitude:pos.coords.longitude,accuracy:pos.coords.accuracy};
  locationPaint();
  const request=pendingLocationIntent;pendingLocationIntent=null;
  if(request){showNearbyResults(request);}
  else { locationStatus.textContent='Location enabled for this tab.'; }
 },err=>{
  if(id!==locationRequestSequence)return;
  locationOff();
  locationStatus.textContent=err.code===1?'Safari blocked location. In Safari, adjust this website’s Location permission to Ask or Allow, then try again.':err.code===3?'Safari location timed out. Please try again.':'Could not get location. Nothing was saved.';
  locationPermissionHint.textContent=locationStatus.textContent;
  locationPermissionBar.hidden=false;
 },{enableHighAccuracy:false,maximumAge:0,timeout:12000});return true;
}
locationButton.addEventListener('click',()=>{if(locationApproved||locationPending)locationOff();else locationOn();});
locationPanel.append(locationTitle,locationDesc,locationButton,locationStatus);$('settings').append(locationPanel);
locationTitle.textContent='Location';locationDesc.textContent='Allow location only when you want nearby suggestions. Toggle anytime.';
const voiceDetails=document.createElement('details');voiceDetails.className='card';
const voiceSummary=document.createElement('summary');voiceSummary.textContent='Voice & listening';voiceSummary.style.cursor='pointer';
voiceCard.replaceWith(voiceDetails);voiceDetails.append(voiceSummary,voiceCard);
locationPanel.insertAdjacentElement('afterend',voiceDetails);
// Keep primary settings in a predictable order without removing any existing controls.
$('settings').prepend(personalCard,themeCard,locationPanel,voiceDetails);

// Location toggle belongs exclusively in Settings. No permanent Home status card.
const locationPermissionBar=document.createElement('div');
locationPermissionBar.id='aurenLocationPermissionBar';
locationPermissionBar.hidden=true;
locationPermissionBar.style.cssText='position:fixed;z-index:9999;left:50%;bottom:18px;transform:translateX(-50%);box-sizing:border-box;width:min(94vw,520px);padding:16px;background:#202127;color:#f3e6c5;border:2px solid #c7a868;border-radius:16px;box-shadow:0 8px 36px rgba(0,0,0,.65);text-align:center;';
const locationPermissionHint=document.createElement('p');
locationPermissionHint.textContent='AUREN needs your permission to use location for nearby suggestions.';
locationPermissionHint.style.cssText='margin:0 0 12px;line-height:1.4;';
const locationPermissionEnable=document.createElement('button');
locationPermissionEnable.type='button';locationPermissionEnable.textContent='Enable location now';
locationPermissionEnable.onclick=()=>locationOn();
const locationPermissionDismiss=document.createElement('button');
locationPermissionDismiss.type='button';locationPermissionDismiss.textContent='Not now';
locationPermissionDismiss.style.marginLeft='9px';
locationPermissionDismiss.onclick=()=>{locationPermissionBar.hidden=true;pendingLocationIntent=null;};
locationPermissionBar.append(locationPermissionHint,locationPermissionEnable,locationPermissionDismiss);
document.body.append(locationPermissionBar);
// Visible results card works on the orb dashboard even when the chat log is hidden.
const nearbyResultPanel=document.createElement('section');nearbyResultPanel.id='aurenNearbyResults';nearbyResultPanel.className='card';nearbyResultPanel.hidden=true;
nearbyResultPanel.style.cssText='box-sizing:border-box;width:min(92%,680px);margin:12px auto;padding:15px;background:#22252b;color:#f3e6c5;border:1px solid #c7a868;border-radius:14px;text-align:center;';
const nearbyResultNote=document.createElement('p');nearbyResultNote.style.cssText='margin:0 0 12px;font-size:13px;line-height:1.5;';
const nearbyResultLink=document.createElement('a');nearbyResultLink.target='_blank';nearbyResultLink.rel='noopener noreferrer';nearbyResultLink.style.cssText='display:inline-block;padding:12px 16px;border-radius:10px;background:#d9ae55;color:#151515;font-weight:700;text-decoration:none;';
nearbyResultPanel.append(nearbyResultNote,nearbyResultLink);$('log').parentElement.append(nearbyResultPanel);
locationPaint();
function locationOffCommand(t){return /\b(?:turn|switch|set|shut|disable|stop)\s+(?:my\s+|the\s+)?location\s*(?:off)?\b/i.test(t)&&/\b(?:off|disable|stop|shut)\b/i.test(t)||/\b(?:stop using|forget|clear|delete)\s+(?:my\s+|the\s+)?location\b/i.test(t);}
function locationOnCommand(t){return /\b(?:turn|switch|set|enable|activate)\s+(?:my\s+|the\s+)?location\s*(?:on)?\b/i.test(t)&&/\b(?:on|enable|activate)\b/i.test(t)||/\b(?:use my location|share my location for this)\b/i.test(t);}
function locationRelevant(t){return /\b(?:nearby|near me|near where i am|around me|closest|where should i go|where can i go|somewhere to (?:go|eat|visit)|places to (?:go|eat|visit)|recommend (?:a|some|me a) (?:place|restaurant)|directions|drive time|traffic|how far from me)\b/i.test(t);}
function offerLocationButton(){
 // Show a fixed, clickable permission action in the visible viewport on Mac/iPhone.
 locationPermissionHint.textContent='Allow AUREN to use your location for this request? You can turn it off anytime.';
 locationPermissionBar.hidden=false;
}


function personalizeMeetingText(text) {
  let t = String(text||'');
  t = t.replace(/\bmeeting\s+(?:with\s+)?my\s+dad\b/gi, 'meeting with your dad')
       .replace(/\bmeeting\s+(?:with\s+)?my\s+mom\b/gi, 'meeting with your mom')
       .replace(/\bmeeting\s+(?:with\s+)?my\s+(father|mother)\b/gi, (_, relation)=>'meeting with your '+relation.toLowerCase());
  return t;
}
function isReassuranceRequest(text){return /^(?:are you sure|you sure|really|is that (?:right|correct|true)|can you confirm (?:that|it)|double.check that)[?.! ]*$/i.test(String(text).trim());}
function mapsSuggestionLink(query) {
  const params=new URLSearchParams({api:'1',query});
  return 'https://www.google.com/maps/search/?'+params;
}
// Name and voice-recognition alias handling lives in the deterministic command layer.
// "Aaron" is only treated as AUREN when used as an address/wake word, never as an
// ordinary person's name in the middle of a conversation.
const AUREN_WAKE_ONLY = /^(?:(?:okay|ok|alright|all right|well|um|uh|please)[, ]*)*(?:hey|hi|hello|yo|okay|ok)\s+(?:auren|aaron|aron|erin|oren|auron|a\s*ren)[.!?, ]*$/i;
const AUREN_ADDRESS = /^(?:(?:okay|ok|alright|all right)[, ]*)?(?:(?:hey|hi|hello|yo)[, ]+)?(?:auren|aaron|aron|erin|oren|auron)[,!:; ]+(?=\S)/i;
function aurenAddressCommand(raw) {
  const spoken = String(raw||'').trim();
  if (AUREN_WAKE_ONLY.test(spoken) || /^(?:auren|aaron|aron|oren)[.!?, ]*$/i.test(spoken)) return {wake:true, command:''};
  const command = spoken.replace(AUREN_ADDRESS,'').trim();
  if (command && command !== spoken) return {wake:false,command};
  return {wake:false,command:spoken};
}
// v2.50: A conversational mention is not automatically a scheduled appointment.
// Store only a short-lived, in-tab draft; require a clear final confirmation.
let contextualMeetingDraft=null;
let contextualPerson=null;
function freshContextualPerson(){return contextualPerson && Date.now()-contextualPerson.at<10*60000?contextualPerson.relation:null;}
function contextualPlannerTurn(raw){
 const t=String(raw||'').trim();
 const mention=t.match(/^(?:i (?:have|got)|i(?:'ve| have) got|there(?:'s| is))\s+(?:an?\s+)?(meeting|appointment|call|lunch|dinner)\s+with\s+(my\s+(?:dad|father|mom|mother|brother|sister)|[\p{L}][\p{L}' -]{1,40})\s+(today|tomorrow|(?:this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\.?$/iu);
 if(mention){
   const date=parseDateIntent(mention[3]);
   if(!date)return null;
   const title=mention[1][0].toUpperCase()+mention[1].slice(1)+' with '+mention[2].trim();
   contextualMeetingDraft={title,date,at:Date.now()};
   if(/^my\s+/i.test(mention[2]))contextualPerson={relation:mention[2].trim(),at:Date.now()};
   return 'Would you like me to add your '+title.toLowerCase()+' to the AUREN calendar?';
 }
 if(contextualMeetingDraft && Date.now()-contextualMeetingDraft.at>5*60000)contextualMeetingDraft=null;
 if(!contextualMeetingDraft)return null;
 if(/^(?:no|no thanks|not now|cancel|never mind)[.!? ]*$/i.test(t)){
   contextualMeetingDraft=null;return 'Certainly. Nothing has been scheduled.';
 }
 if(/^(?:yes|yeah|sure|okay|please|go ahead)[.!? ]*$/i.test(t))return 'What time should I put it down for, including AM or PM?';
 const m=t.match(/^(?:(?:yes|yeah|sure|okay)[, ]+)?(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\s*[.!?]*$/i);
 if(m){
   const time=timeFromText('at '+m[1]+(m[2]?':'+m[2]:'')+' '+m[3]);
   if(!time||time==='ambiguous')return 'Which time did you mean, including AM or PM?';
   const draft=contextualMeetingDraft;contextualMeetingDraft=null;
   pendingPlan={kind:'add',title:draft.title,date:draft.date,time,duration:60};
   const conflict=conflictAdvice(pendingPlan);
   return conflict||`Shall I save ${draft.title} for ${readableDate(draft.date)} at ${formatClock(time)}?`;
 }
 // Handle a new topic without hijacking an unrelated conversation.
 if(/^(?:add|schedule|book|move|change|remove|delete|what|why|how|tell|explain|find|take|look|search|let)/i.test(t))contextualMeetingDraft=null;
 return null;
}
// Resolve pronouns only with a recent, unambiguous saved calendar event.
function contextualMoveTurn(raw){
 const t=String(raw||'').trim();
 const m=t.match(/^(?:(?:actually|please)[, ]+)?(?:move|change|reschedule)\s+(?:it|that|the meeting|the appointment)\s+(?:to|for)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:instead)?[.!?]*$/i);
 if(!m||pendingPlan||planClarification)return null;
 const event=plans.find(p=>p.id===lastDiscussedPlanId);
 if(!event)return 'Which saved appointment would you like me to move?';
 let time;
 if(m[3])time=timeFromText('at '+m[1]+(m[2]?':'+m[2]:'')+' '+m[3]);
 else {
   const h=Number(m[1]), oldHour=Number(event.time.slice(0,2));
   // "4 instead" inherits the daypart from an explicitly discussed 3 PM event.
   if(h<1||h>12)return 'Please give the new time, including AM or PM.';
   time=String(h%12+(oldHour>=12?12:0)).padStart(2,'0')+':'+String(m[2]||'00');
 }
 if(!time||time==='ambiguous')return 'Would that be AM or PM?';
 pendingPlan={kind:'move',id:event.id,title:event.title,date:event.date,time,duration:event.duration||60};
 return conflictAdvice(pendingPlan)||`Shall I move ${event.title} to ${formatClock(time)} on ${readableDate(event.date)}?`;
}
async function send(text) {
  const addressed = aurenAddressCommand(text);
  if (addressed.wake) {
    await addMessage('user',text);
    await addMessage('auren',varyButler('wake', ['At your service.','Listening.','Yes?','Ready.']));
    return;
  }
  text=addressed.command;
  // Recovery is explicit and safe: only rerun a recent failed informational AI query.
  if(RETRY_INTENT.test(text.trim())){
    const retry=takeRetryableQuestion();
    await addMessage('user',text);
    if(!retry){await addMessage('auren','There is no recent failed question I can safely retry. Please ask it again.');return;}
    if(!getAIEndpoint()){await addMessage('auren','My AI connection is not configured. Please check Settings.');return;}
    try{
      const reply=await askWithMemory(retry);
      await addMessage('auren',reply);
    }catch(error){
      rememberFailedAIQuestion(retry);
      console.error('AUREN retry failed',error);
      await addMessage('auren','I still cannot reach my AI service. Your planner and saved information have not been changed.');
    }
    return;
  }
  // Natural corrections take priority over saved-memory disputes and incomplete prior prompts.
  const corrected=parseConversationCorrection(text);
  if(corrected!==null){
    const old=freshConversationReference();
    if(corrected){
      conversationCorrection={at:Date.now(),question:old?.question||'',reply:old?.reply||''};
      await addMessage('user',text);
      if(!getAIEndpoint()){
        await addMessage('auren','Understood. Please reconnect my AI service in Settings so I can answer the corrected question.');
      }else{
        try{const answer=await askWithMemory(corrected);await addMessage('auren',answer);}
        catch(error){rememberFailedAIQuestion(corrected);console.error('Correction response failed',error);await addMessage('auren','I understood the correction, but could not reach my AI service. You can say try that again.');}
      }
      return;
    }
    await addMessage('user',text);
    await addMessage('auren',old?'Understood. Which part did I misunderstand?':'Which part would you like me to correct?');
    return;
  }
  // A deliberate topic switch discards stale AI conversational references.
  if(conversationTopicChange(text)){
    aurenRetireConversationTopic();
    await addMessage('user',text);
    await addMessage('auren','Certainly. What would you like to discuss?');
    return;
  }
  // Natural pivots like 'let's talk about cars instead' begin a new AI topic.
  // Do not carry old music preferences or previous AI turns into that answer.
  const topicShift=aurenTopicShift(text);
  if(topicShift.changed){
    aurenRetireConversationTopic();
    text=topicShift.question;
  }
  const contextMove=contextualMoveTurn(text);
  if(contextMove){await addMessage('user',text);await addMessage('auren',contextMove);return;}
  const contextDraft=contextualPlannerTurn(text);
  if(contextDraft){await addMessage('user',text);await addMessage('auren',contextDraft);return;}
  if (await aurenPlaces.handle(text)) {conversationAnchor=null;return;}
  if(conversationalReference(text)&&!readConversationAnchor()){
    await addMessage('user',text);
    await addMessage('auren','Which part would you like me to explain?');
    return;
  }
  // Ordinary web searches are distinct from GPS place searches.
  const webRequest=String(text||'').trim().match(/^(?:auren[, ]+)?(?:can you |could you |please )?(?:search (?:the )?(?:web|internet|google) (?:for )?|look (?:up|online for) |google )(.{3,140})[.!?]*$/i);
  if(webRequest && !/\b(?:near me|nearby|around me|closest|where should i go)\b/i.test(webRequest[1])) {
    const query=webRequest[1].trim();
    await addMessage('user',text);
    await addMessage('auren',`I can open web results for ${query}, but cannot directly read them inside AUREN yet. Select the link to search.`);
    const row=document.createElement('p');
    const link=document.createElement('a');link.href='https://www.google.com/search?q='+encodeURIComponent(query);link.target='_blank';link.rel='noopener noreferrer';link.textContent='Search the web for '+query;
    row.append(link);$('log')?.append(row);
    return;
  }
  // Location commands take priority over AI. Only a direct button tap triggers Safari's GPS prompt.
  const clean=String(text||'').trim();
  const localPersonal=personalCommand(clean);
  if(localPersonal){await addMessage('user',clean);await addMessage('auren',localPersonal);return;}
  const recalled=await directPersonalRecall(clean);
  if(recalled!==null){await addMessage('user',clean);await addMessage('auren',recalled);return;}
  if(personalPendingInterest && /^(?:yes|yeah|sure|save it|remember it|please do|go ahead|no|no thanks|not now|nah|skip)[.! ]*$/i.test(clean)){await addMessage('user',clean);if(await personalInterestConfirmation(clean))return;}
  if(locationOffCommand(clean)){
   locationOff();await addMessage('user',clean);
   await addMessage('auren','Location turned off.');return;
  }
  if(pendingLocationIntent&&/^(?:no|no thanks|not now|cancel|don't|do not|nah)[.! ]*$/i.test(clean)){
   pendingLocationIntent=null;locationPermissionBar.hidden=true;await addMessage('user',clean);
   await addMessage('auren','Of course. Location stays off. You can also give me a city or neighborhood.');return;
  }
  if(pendingLocationIntent&&/^(?:yes|yeah|yep|sure|okay|ok|go ahead|please do|enable it|of course|do it)[.! ]*$/i.test(clean)){
   await addMessage('user',clean);
   if(locationApproved){const request=pendingLocationIntent;pendingLocationIntent=null;showNearbyResults(request);await addMessage('auren','Location is already on. I’ve prepared the nearby map results below.');}
   else {await addMessage('auren','Yes—I can use location for this search. Click the visible Enable location now button to approve Safari’s GPS request.');offerLocationButton();}
   return;
  }
  if(locationOnCommand(clean)){
   await addMessage('user',clean);
   if(locationApproved){await addMessage('auren','Your location is already on for this tab.');}
   else {await addMessage('auren','Click Enable location now to switch on location for this tab. Safari controls the permission prompt.');offerLocationButton();}
   return;
  }
  // Smart Places owns nearby discovery and its permission/results flow.
  // Route GPS-free traffic/directions requests to a map link only when requested.
  // A simple request for reassurance is about the most recent statement,
  // not an invitation to replay unrelated memories or apologize automatically.
  if (isReassuranceRequest(text)) {
    await addMessage('user',text);
    if (lastSubstantiveReply) {
      let check;
        try { check=await askWithMemory('Please verify your last answer, rather than merely repeating it. I asked: '+text+'. What can be checked against my plans and what remains uncertain?'); }
        catch { check='I cannot independently verify that statement right now. Check Your Day for saved appointments.'; }
        await addMessage('auren',personalizeMeetingText(check));
    } else await addMessage('auren','Which detail would you like me to verify?');
    return;
  }
  // Handle "repeat that" before briefing commands or AI routing; replay is
  // verbatim and never replaces the remembered answer with itself.
  if (REPEAT_LAST_REPLY.test(String(text).trim())) {
    if (briefingPlayer.active) briefingPlayer.pause();
    await addMessage('user', text);
    if (lastSubstantiveReply) {
      await addMessage('auren', lastSubstantiveReply, {replay:true});
    } else {
      await addMessage('auren', 'There is not a previous reply to repeat yet.', {replay:true});
    }
    return;
  }
  if(briefingPlayer.active) briefingPlayer.pause();
  const briefingCommand=briefingPlayer.ask(text);
  if(briefingCommand){
    await addMessage('user',text);
    await addMessage('auren',briefingCommand,{silent:true});
    return;
  }
  // Preserve the user's Read replies aloud preference. Text messages must not
  // turn speech on automatically or override the user's explicit setting.
  // Voice initiated from the orb still enables speech in the orb handler.
  await addMessage('user', text, { ephemeral: isSessionNote(text) });
  try {
    // Respond to location-related requests only when the user asks. No live
    // traffic or nearby-business data is invented. Do not transmit coordinates
    // automatically; a maps search only opens after the user clicks a link.
    const nearbyRequest=/\b(?:near(?:by| me)|close to me|around me|places near|recommend.*near)\b/i.test(text);
    const trafficRequest=/\b(?:traffic|how busy (?:the )?roads|drive time)\b/i.test(text);
    if(nearbyRequest || trafficRequest){
      if(!locationApproved || !aurenLocation){
        await addMessage('auren','Location is off. You can enable it in Settings or provide an area instead.');offerLocationButton();
      } else {
        const subject=trafficRequest ? 'traffic and directions' : 'nearby places';
        await addMessage('auren',`I can help you look up ${subject}, but I cannot verify live road conditions inside AUREN yet. Would you like to open a maps search?`);
        const link=document.createElement('a');
        link.href=mapsSuggestionLink(trafficRequest?'traffic near me':text.replace(/[^a-z0-9 -]/gi,' ').slice(0,90));
        link.target='_blank';link.rel='noopener noreferrer';link.textContent='Open Maps (optional)';
        link.className='hint';$('log').append(link);
      }
      return;
    }
    // A topic change is an invitation to listen, NOT a request to list projects,
    // memories or previous subjects. Retire unfinished topic-specific offers.
    const topicChange=/^(?:(?:auren[, ]+)?(?:i(?:'d| would)? (?:like|want|need) to (?:talk|speak|chat) (?:about|on) (?:something else|another (?:topic|thing)|something different)|(?:can|could) we (?:talk about|discuss|switch to) (?:something else|something different|another topic)|(?:let's|lets) (?:change|switch) (?:the )?(?:subject|topic)|(?:new|different) (?:topic|subject)|(?:i want to )?change the subject|(?:i have|i've got) something else (?:to (?:talk about|discuss)|on my mind)))[.!?]*$/i.test(text.trim());
    if (topicChange) {
      pendingPlan=null;pendingReminder=null;planClarification=null;
      planningOffer=null;pendingWeatherOffer=null;
      await addMessage('auren','Of course. What would you like to talk about?');
      return;
    }
    // A request for general help is not a continuation of a previously discussed
    // appointment, walk, project, or weather forecast. Handle it before any
    // pending-topic, AI-memory or planner routing can latch onto stale context.
    const generalHelpRequest = /^(?:(?:please\s+)?(?:ask\s+me|can\s+you\s+ask\s+me|could\s+you\s+ask\s+me)\s+(?:what\s+I\s+(?:need|want)(?:\s+help\s+with)?|how\s+(?:you\s+can\s+help\s+me|I\s+am\s+doing))|(?:what\s+can\s+you\s+help\s+me\s+with|how\s+can\s+you\s+help\s+me|ask\s+me\s+how\s+you\s+can\s+help|can\s+you\s+help\s+me\s+with\s+something|I\s+need\s+(?:some\s+)?help))\s*[.!?]*$/i.test(text.trim());
    if (generalHelpRequest) {
      planningOffer = null;
      pendingWeatherOffer = null;
      await addMessage('auren', varyButler('generalHelp', [
        'Certainly. What can I help you with?',
        'Of course. What would you like assistance with?',
        'At your service. What do you need help with?',
        'Certainly. What would you like to do?'
      ]));
      return;
    }
    // Dedicated device-local clock and schedule-action routing: general AI must not fabricate planner outcomes.
    const clockRequest=/^(?:(?:auren[, ]+)?(?:what(?:'s| is) the|tell me the|give me the|what is the current)\s+(?:current\s+)?(?:time|date)(?:\s+(?:in|for)\s+(?:dallas|chicago))?|what time is it|what day is it)(?:\s+(?:right now|now))?[.!?]*$/i.test(text.trim());
    if(clockRequest){
      const clock=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',weekday:'long',month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date());
      await addMessage('auren',`In Dallas, it is ${clock}, Central Time.`);return;
    }
    if(/^(?:how much time (?:do i have|is left) (?:before|until) (?:my )?next (?:meeting|appointment|plan)|do i have time before my next (?:meeting|appointment|plan)|how long (?:until|before) my next (?:meeting|appointment|plan))[.!? ]*$/i.test(String(text).trim())){
      noteDayConversation(localDate(),'day');
      await addMessage('auren',nextOpeningIntelligence());
      return;
    }
    // v2.40: explicit task operations are separate from calendar events.
    if(!pendingPlan && !pendingReminder && !planClarification){
      const confirmation=taskConfirmation(text);
      if(confirmation!==null){await addMessage('auren',confirmation);return;}
      const taskRequest=taskIntent(text);
      if(taskRequest){await addMessage('auren',taskResponse(taskRequest));return;}
    }
    // v2.42: grounded preparation summaries that never alter plans.
    const prepareRequest=preparationIntent(text);
    if(prepareRequest){await addMessage('auren',preparationReply(prepareRequest));return;}
    // v2.41: read-only deadline summaries and free calendar openings.
    const deadlineRequest=deadlineIntent(text);
    if(deadlineRequest){await addMessage('auren',deadlineReply(deadlineRequest));return;}
    // v2.39: adaptive briefings and follow-ups, grounded in local saved data.
    const adaptiveRequest=adaptiveIntent(text);
    if(adaptiveRequest){
      const response=adaptiveRequest.kind==='priority' ? adaptivePriority(adaptiveRequest.date,adaptiveRequest.scope)
        : adaptiveBriefing(adaptiveRequest.date,adaptiveRequest.scope,adaptiveRequest.detail);
      await addMessage('auren',response);return;
    }
    const adaptiveFollow=adaptiveFollowup(text);
    if(adaptiveFollow!==null){await addMessage('auren',adaptiveFollow);return;}
    // v2.38: respond with verified preparation guidance, without creating a task.
    const proactiveIntent=proactiveDayIntent(text);
    if(proactiveIntent){
      await addMessage('auren',proactiveDayReply(proactiveIntent));
      return;
    }
    const proactiveFollowup=readinessFollowup(text);
    if(proactiveFollowup!==null){await addMessage('auren',proactiveFollowup);return;}
    // Priority questions are direct, concise and based on device-local saved data.
    const nextActionIntent=priorityIntelligenceIntent(text);
    if(nextActionIntent){
      noteDayConversation(nextActionIntent.date,nextActionIntent.scope);
      await addMessage('auren',nextActionIntelligence(nextActionIntent.date,nextActionIntent.scope));
      return;
    }
    // Grounded personal-day questions take priority over generic AI; never invent plans.
    const dayIntent=dailyIntelligenceIntent(text);
    if(dayIntent){
      noteDayConversation(dayIntent.date,dayIntent.scope);
      const response=spokenDayIntelligence(dayIntent.date,dayIntent.scope);
      await addMessage('auren',response);
      return;
    }
    if(/^(?:schedule|add|book|move|reschedule|delete|remove|cancel appointment|actually[, ]+move)\b/i.test(String(text).trim())) dayConversation=null;
    // Interpret brief day follow-ups only after a recent, grounded day conversation.
    const dayFollowup=dayFollowupReply(text);
    if(dayFollowup!==null){ await addMessage('auren',dayFollowup); return; }
    if(/^(?:tell me (?:more )?about|review|show|explain) (?:my |the )?(?:conflict|conflicts|overlapping appointments)[.!? ]*$/i.test(text.trim())){
      const report=savedDayIntelligence(localDate(),'week');
      await addMessage('auren',report.conflictPairs.length
        ? 'Saved overlapping appointments: '+report.conflictPairs.slice(0,3).map(([a,b])=>`${a.title} and ${b.title} on ${readableDate(a.date)}`).join('; ')+'. I have not changed anything.'
        : 'I cannot find overlapping appointments in your saved AUREN planner this week.');
      return;
    }
    if(/^(?:actually[, ]+)?(?:tomorrow|today|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)) instead[.!? ]*$/i.test(text.trim()) && !pendingPlan && !planClarification){
      await addMessage('auren','Do you want to review that day, or change a saved appointment? Nothing has been changed.');return;
    }
    // An imminent departure is NOT a request to schedule; never infer a conflict hours away.
    const leaving=text.trim().match(/^(?:i\s+(?:need|have|got)\s+to|i(?:'m| am)\s+going\s+to)\s+(?:leave|head out|go)(?:\s+(?:for|to)\s+(.+?))?\s+in\s+(\d{1,3})\s*(minutes?|mins?|hours?|hrs?)\b/i);
    if(leaving){
      const mins=Number(leaving[2])*(/^h/i.test(leaving[3])?60:1),leaveAt=Date.now()+mins*60000;
      const soon=plans.filter(p=>{const at=eventTimestamp(p);return at>=Date.now()&&at<=leaveAt+15*60000;}).sort((a,b)=>eventTimestamp(a)-eventTimestamp(b));
      const destination=leaving[1]?' for '+leaving[1].trim().replace(/[.!?]+$/,''):'';
      const conflict=soon.length?` Your ${soon[0].title} is scheduled for ${readableDate(soon[0].date)} at ${spokenClock(soon[0].time)}, close to your departure.`:'';
      const clear=soon.length?'':' I do not see an immediate conflict with your saved AUREN appointments. I cannot tell whether you have enough travel time without knowing the journey.';
      await addMessage('auren',`Understood. You plan to leave${destination} in ${mins} ${mins===1?'minute':'minutes'}.${conflict}${clear}`);return;
    }
    // Acknowledge the user's own timing assessment without inventing a conflicting event.
    if (/^(?:(?:i|we) (?:have|got|do have) (?:enough|plenty of|lots of) time|there(?:'s| is) (?:enough|plenty of) time|i(?:'m| am) not (?:in a rush|running late))[.!?]*$/i.test(text.trim())) {
      await addMessage('auren', 'Understood. If you have enough time, there is no need to rush. I will follow your lead.');
      return;
    }
    // Distinguish AUREN's own planner from external device calendars.
    if (/\b(?:you (?:can't|cannot|couldn't)|you (?:said|told me) (?:you )?can't|can't you|why can't you)\b.*\b(?:schedule|calendar|appointment|event|add|save)\b/i.test(text)) {
      await addMessage('auren', 'I can add and change appointments in Your Day, AUREN’s built-in planner, after your confirmation. External calendar apps are separate. What would you like me to schedule?');
      return;
    }
    const directPlanner=normalizedPlannerRequest(text);
    if(directPlanner){
      const result=await planSpeech(text);
      if(result){await addMessage('auren',result);return;}
    }
    // Calendar exports intentionally disabled; events stay in Your Day.
    // Uncertainty is not a scheduling commitment or a reason to pressure the user.
    const unsure = respectfulUncertainty(text);
    if(unsure){await addMessage('auren',unsure);return;}
    // Offer assistance once after a forecast. Only give clothing suggestions if requested.
    if (pendingWeatherOffer) {
      const response = text.trim().toLowerCase().replace(/[.!?]+$/, '');
      if (/^(?:yes|yeah|yep|sure|please|go ahead|sounds good|what should i wear|help me dress)$/.test(response)) {
        const data = pendingWeatherOffer; pendingWeatherOffer = null;
        const clothing = data.high <= 50 ? 'a warm coat or layers' : data.high <= 68 ? 'a light jacket or sweater' : 'comfortable, breathable clothing';
        const rain = data.rainChance >= 40 ? ', and a rain jacket or umbrella' : '';
        await addMessage('auren', `For ${data.label}, I would suggest ${clothing}${rain}.`);
        return;
      }
      pendingWeatherOffer = null; // Another request means do not push suggestions.
      if (/^(?:no|no thanks|not now|nah|nope)$/.test(response)) {
        await addMessage('auren', varyButler('offerNo', ['Very well.', 'Of course.', 'Understood.']));
        return;
      }
    }
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
      const weekday = cleaned.match(/\b(?:(?:this|next|on)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
      const scope = weekday ? weekday[1].toLowerCase()
        : /\b(?:day after tomorrow)\b/i.test(cleaned) ? 'day after tomorrow'
        : /\btomorrow\b/i.test(cleaned) ? 'tomorrow'
        : /\b(week|weekly|next\s+7\s+days|seven\s+days)\b/i.test(cleaned) ? 'week'
        : /\b(today|tonight)\b/i.test(cleaned) ? 'day'
        : (weatherFresh ? recentWeatherScope : 'day');
      // A short question such as 'what about the wind?' inherits the last forecast day.
      // 'What about 4 PM?' inherits the topic, but not an imaginary AM/PM value.
      const hourText = cleaned.match(/\b(?:at|around|about|by)\s+(\d{1,2})(?::\d{2})?\s*(?:am|pm)\b/i);
      const currentHour = hourText ? hourText[0] : null;
      const inherited = !currentHour && recentWeatherHour && contextualWeather
        && !/\b(today|tomorrow|week|morning|afternoon|evening|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(cleaned)
        ? ` ${recentWeatherHour}` : '';
      recentWeatherScope = scope;
      recentWeatherAt = Date.now();
      if (currentHour) recentWeatherHour = currentHour;
      else if (/\b(today|tomorrow|week|morning|afternoon|evening|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(cleaned)) recentWeatherHour = null;
      const weather = await getWeatherBriefing(city, scope, cleaned + inherited);
      if (weather.success) {
        lastWeatherDetails = weather;
        // Ask once, rather than supplying unsolicited clothing instructions.
        pendingWeatherOffer = Number.isFinite(weather.high)
          ? { high: weather.high, rainChance: weather.rainChance ?? 0, label: weather.label }
          : null;
        const offer = pendingWeatherOffer
          ? ' Would you like a suggestion for what to wear?'
          : '';
        await addMessage('auren', weather.spoken + offer);
      } else {
        pendingWeatherOffer = null;
        await addMessage('auren', weather.spoken || `I couldn't retrieve the forecast for ${city} just now.`);
      }
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
          `Remember this for future conversations?\n“${candidate}”\nNot saved yet.`));
      }
    } else {
      speechPanelText.textContent = 'AUREN: One moment…';
      const answer = await askWithMemory(text);
      if(planningSuggestion){planningOffer={prompt:planningSuggestion};lastPlanningOfferAt=Date.now();}
      const interestOffer=observeInterest(text);
      await addMessage('auren', [answer,planningSuggestion,interestOffer].filter(Boolean).join('\n\n'));
    }
  } catch (e) {
    // Make request failures audible too; previously err:true suppressed voice output,
    // so users heard silence and had no clue whether the Worker had responded.
    rememberFailedAIQuestion(text);
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
$('chatForm').onsubmit = e => { e.preventDefault(); const v = $('chatInput').value.trim(); if (v) { if($('speakReplies').checked) voice.primeAudio(); $('chatInput').value = ''; safe(send)(v); } };

async function loadHistory() {
  const msgs = (await getAll(STORES.messages)).filter(m => m.role === 'user' || m.role === 'auren').sort((a, b) => a.at.localeCompare(b.at));
  if (!msgs.length) return addMessage('auren', "At your service.", {silent:true});
  msgs.forEach(m => drawMessage(m));
  const last = [...msgs].reverse().find(m => m.role === 'auren' && m.text && !m.text.startsWith('[session note'));
  if (last && !lastSubstantiveReply) rememberLastReply(last.text);
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

// AUREN v2.15 SMART PLACES: opt-in, any-category place search, safe Maps return flow.
aurenPlaces = (() => {
  let phase='idle', pending='', coords=null, results=[], requestId=0, lastMapClick=0, mapPending=false, returned=false, lookupFailed=false, navigationTarget='', awaitingPlace=false, lastNavigationAt=0, lastPlacePromptAt=0;
  const yes=/^(?:yes|yep|yeah|sure|okay|ok|go ahead|please do|use my location|enable it)[.!? ]*$/i;
  const no=/^(?:no|nope|no thanks|not now|cancel)[.!? ]*$/i;
  const done=/^(?:done|finished|i(?:'m| am) done|that's all|end search|close results|stop searching)[.!? ]*$/i;
  const repeat=/^(?:repeat|repeat that|say that again|show (?:them|those|the places|results) again|what were the places)[.!? ]*$/i;
  const broadPlaceIntent=/\b(?:find|show|suggest|recommend|search|look for|looking for|take me to|i want|i need|could use|want to find)\b[\s\S]{0,80}\b(?:place(?:s)?|somewhere|restaurant(?:s)?|eat|food|dinner|lunch|breakfast|coffee|cafe|shop(?:ping)?|store(?:s)?|park(?:s)?|gym(?:s)?|museum(?:s)?|library|barber|salon|hotel|gas station|car wash|mechanic|movie|theater|arcade|bowling|pharmacy|mcdonald'?s|starbucks|walmart|target)\b|\b(?:anything (?:fun )?to do|what(?:'s| is) (?:around|near) me|something to do|somewhere to go|places around here|where to go|places (?:for|to) (?:eat|visit|shop))\b/i;
  // Understand requests for any named destination, not just a preset brand list.
  // Only route explicit navigation phrasing; normal questions stay with the AI.
  // Natural destinations and imperfect Safari voice transcripts are handled locally,
  // before generic traffic advice or the AI model can reinterpret navigation as a question.
  // Navigation is a user intention, not a claim that AUREN can drive a car.
  // Avoid passing requests for directions to the general chatbot.
  function destinationFrom(text) {
    let t=String(text||'').normalize('NFKC').replace(/[’]/g,"'").trim();
    t=t.replace(/^(?:(?:hey|hi|okay|ok)\s+)?auren\s*[,!:.]?\s*/i,'')
       .replace(/^(?:(?:can|could|would|will)\s+you\s+|please\s+|i\s+(?:want|need)\s+(?:you\s+)?to\s+)/i,'')
       .replace(/[.!?]+$/,'').trim();
    // Ignore leading conversational connectors in follow-up turns.
    t=t.replace(/^(?:and|then|also|yes|yeah|okay|ok|alright|well|so)\s*[,.:]?\s+/i,'');
    // Handle Safari duplicate transcripts where a business name precedes the command.
    // e.g. 'McDonald's take me to McDonald's'.
    const echoed=t.match(/^(.{2,70}?)\s+(?:take|bring|drive|guide|lead)\s+me\s+to\s+(.+)$/i);
    if(echoed && echoed[2].trim())t='take me to '+echoed[2].trim();
    // Covers speech-recognition insertions: 'take me find directions to Chipotle'.
    const starters=[
      /^(?:take|bring|drive|guide|lead)\s+me\s+(?:(?:to|find|show|get|the|some|directions|direction|route|routes|for)\s+){0,5}(?:to\s+)?(.+)$/i,
      /^(?:navigate|route)\s+(?:me\s+)?(?:to\s+)?(.+)$/i,
      /^(?:(?:find|show|get|give)\s+(?:me\s+)?(?:the\s+)?(?:directions?|route|way)\s+(?:to|for)\s+)(.+)$/i,
      /^(?:(?:how\s+(?:do|can|would)\s+i\s+(?:get|drive|go)\s+to)|(?:where\s+is\s+the\s+(?:nearest|closest))|(?:open|pull\s+up|bring\s+up)\s+(?:google\s+)?maps\s+(?:for|to))\s+(.+)$/i,
      /^(?:go|head|drive)\s+to\s+(.+)$/i,
      /^(?:directions?\s+(?:to|for))\s+(.+)$/i,
      /^(?:get|show|give|send|open)\s+(?:me\s+)?(?:the\s+)?(?:directions?|route|map)\s+(?:to|for)\s+(.+)$/i
    ];
    let m=null;
    for(const pattern of starters){m=t.match(pattern);if(m)break;}
    if(!m)return '';
    let dest=m[1].trim().replace(/^(?:(?:me|to|the)\s+)+/i,'')
      .replace(/^(?:nearest|closest|a|an)\s+/i,'')
      .replace(/\s+(?:please|for me|near me|nearby|around me)$/i,'').trim();
    // Safari sometimes repeats the destination before its command:
    // 'McDonald's take me to McDonald's' -> 'McDonald's'.
    dest=dest.replace(/^(.{2,65}?)\s+(?:take|bring|drive|guide|lead)\s+me\s+to\s+(.+)$/i,(_all,first,second)=>second.trim());
    dest=dest.replace(/^(.{2,65}?)\s+(?:navigate|directions?)\s+to\s+(.+)$/i,(_all,first,second)=>second.trim());
    if(!dest||dest.length<2||dest.length>110||/^(?:me|there|somewhere|a place|places|the place|a restaurant|a store|it|that)$/i.test(dest))return '';
    // Avoid routing application commands or abstract requests to Google Maps.
    if(/^(?:settings?|text chat|history|the home screen|my (?:schedule|calendar|memories)|sleep|bed|the next sentence|the previous page)$/i.test(dest))return '';
    if(/^(?:do|be|have|feel|know|say|tell|help|see|find out|remember|understand)\b/i.test(dest))return '';
    return dest;
  }
  // For named-business searches: don't require businesses to be in a hard-coded list.
  function namedPlaceSearch(text){
    const t=String(text||'').trim().replace(/^(?:hey\s+)?auren[,.! ]*/i,'').replace(/[.!?]+$/,'');
    const m=t.match(/^(?:(?:please|can you|could you)\s+)?(?:find|locate|search for|show)(?:\s+me)?\s+(?:a|an|the|nearest|closest|nearby)?\s*([a-z][a-z0-9 &'’.-]{2,65})(?:\s+(?:near me|nearby|around me|in my area))?$/i);
    if(!m)return '';
    const d=m[1].trim().replace(/\s+(?:near me|nearby|around me|in my area)$/i,'');
    if(/^(?:my memories|my schedule|my appointments|my projects|my notes|the answer|that|it|help|information|a way|a solution)$/i.test(d))return '';
    return d;
  }
  // Never search an incomplete voice phrase; wait for a meaningful destination.
  function incompletePlaceRequest(raw){
    const t=String(raw||'').trim().toLowerCase().replace(/^(?:hey\s+)?auren[,! ]*/,'').replace(/[.!?]+$/,'').trim();
    if(!/^(?:(?:can|could|would) you\s+|please\s+)?(?:find|take|show|search|look|recommend|suggest|navigate|directions|go)\b/.test(t))return false;
    if(/\b(?:um+|uh+|erm+|hmm+|like|you know)\s*$/.test(t))return true;
    if(/\b(?:to|for|at|near|a|an|the|some|somewhere|place|places|spot|spots|location|locations|me)\s*$/.test(t))return true;
    return /^(?:find me|find me a|find me a place|take me|take me to|show me|directions to|navigate to|search for|look for|recommend somewhere)$/.test(t);
  }
  function meaningfulSearchTerm(raw){
    const s=String(raw||'').trim().replace(/\b(?:um+|uh+|erm+|hmm+)\b/gi,'').trim();
    if(s.length<3)return false;
    return !/^(?:me|a|an|the|some|place|places|somewhere|spot|spots|location|locations|near me|nearby|to|for|there|anything)$/i.test(s);
  }
  const placeIntent=/\b(?:where (?:should|can|could) (?:i|we) (?:go|eat|shop|visit)|(?:find|show|suggest|recommend|look up|search for)\s+(?:me\s+)?(?:some\s+|a\s+|an\s+|the\s+|nearby\s+|closest\s+|good\s+|best\s+)*(?:places?|locations?|spots?|things to do|restaurants?|food|cafes?|coffee shops?|mcdonald'?s|chick.fil.a|starbucks|parks?|gyms?|stores?|shops?|museums?|libraries|theaters?|cinemas?|bowling|hiking|pharmacies|gas stations?|hotels?|barbers?|salons?|car washes?|mechanics?|dealerships?|bookstores?|arcades?|grocery stores?|supermarkets?|walmart|target)|(?:near me|nearby|closest to me|around me|in my area))\b/i;
  const panel=document.createElement('section');panel.id='aurenSmartPlacesV215';panel.className='card';panel.style.cssText='margin:12px auto;width:min(92%,680px);padding:14px;border:1px solid rgba(199,168,104,.38);border-radius:14px;background:#191b20;color:#ebd9b2;display:none';
  const heading=document.createElement('strong'), content=document.createElement('div'), actions=document.createElement('div');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap;margin-top:12px';panel.append(heading,content,actions);
  // Keep all Smart Places controls in Settings, never on the orb/home dashboard.
  $('settings').append(panel);
  const action=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=fn;actions.append(b);return b;};
  const show=(title,message)=>{heading.textContent=title;content.replaceChildren();if(message){const p=document.createElement('p');p.textContent=message;content.append(p);}actions.replaceChildren();panel.style.display='block';};
  const hide=()=>{panel.style.display='none';content.replaceChildren();actions.replaceChildren();};
  const clear=()=>{requestId++;phase='idle';pending='';coords=null;results=[];lookupFailed=false;navigationTarget='';awaitingPlace=false;lastNavigationAt=0;mapPending=false;returned=false;hide();closePopup();const n=document.getElementById('aurenMapsReturnNotice');if(n)n.style.display='none';};
  // Temporary, request-only Maps overlay. No persistent location card on Home.
  const mapOverlay=document.createElement('div');mapOverlay.id='aurenMapsTemporaryOverlay';
  mapOverlay.style.cssText='position:fixed;inset:0;z-index:11000;background:rgba(0,0,0,.65);display:none;align-items:center;justify-content:center;padding:18px;box-sizing:border-box;';
  const mapCard=document.createElement('section');mapCard.style.cssText='width:min(100%,480px);max-height:82vh;overflow:auto;background:#1d2026;border:1px solid #c7a868;border-radius:18px;padding:22px;color:#eee0be;box-shadow:0 18px 60px #0009;';
  const mapTitle=document.createElement('h3');mapTitle.textContent='AUREN · Nearby places';mapTitle.style.margin='0 0 12px';
  const mapText=document.createElement('p');mapText.style.lineHeight='1.5';
  const mapChoices=document.createElement('div');mapChoices.style.cssText='display:flex;gap:9px;flex-wrap:wrap;flex-direction:column;margin-top:14px;';
  mapCard.append(mapTitle,mapText,mapChoices);mapOverlay.append(mapCard);document.body.append(mapOverlay);
  const returnNotice=document.createElement('div');returnNotice.id='aurenMapsReturnNotice';
  returnNotice.style.cssText='position:fixed;right:16px;bottom:18px;z-index:9000;max-width:min(420px,calc(100vw - 32px));padding:14px;background:#22252b;color:#f2e1bf;border:1px solid #c7a868;border-radius:14px;box-shadow:0 6px 25px #0008;display:none;';
  const noticeText=document.createElement('p');noticeText.style.cssText='margin:0 0 10px;line-height:1.4';
  const noticeClose=document.createElement('button');noticeClose.type='button';noticeClose.textContent='Dismiss';noticeClose.onclick=()=>{returnNotice.style.display='none';};
  const noticeAgain=document.createElement('button');noticeAgain.type='button';noticeAgain.textContent='More options';noticeAgain.style.marginLeft='8px';noticeAgain.onclick=()=>{returnNotice.style.display='none';displayResults(false);};
  returnNotice.append(noticeText,noticeClose);document.body.append(returnNotice);
  let greetingCount=0;const greetings=['Welcome back. Did you find what you needed?','Back from Maps. Would you like another option?','Good to have you back. How did the search go?','Welcome back. Need more places to choose from?','How was the map search? I can help you find something else.'];
  const popupButton=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.style.cssText='border-radius:10px;padding:12px;cursor:pointer;';b.onclick=fn;mapChoices.append(b);return b;};
  function closePopup(){mapOverlay.style.display='none';mapChoices.replaceChildren();}
  mapOverlay.addEventListener('click',e=>{if(e.target===mapOverlay)closePopup();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mapOverlay.style.display!=='none')closePopup();});
  function showPopup(message,places=[]){
    const hasResults=places.length>0;
    const busy=phase==='searching'||phase==='locating';
    mapTitle.textContent='AUREN · '+(pending||'Nearby places');
    mapText.textContent=hasResults?message:(lookupFailed||phase==='results'&&!hasResults
      ? 'No verified nearby listings available. You can open Google Maps instead.'
      : message);
    mapChoices.replaceChildren();mapOverlay.style.display='flex';
    if(hasResults){
      const list=document.createElement('div');list.style.cssText='display:grid;gap:9px;margin:8px 0 12px';
      for(const place of places.slice(0,8)){
        const card=document.createElement('div');card.style.cssText='padding:11px;border:1px solid rgba(199,168,104,.35);border-radius:12px;background:#292b31';
        const name=document.createElement('strong');name.textContent=place.name;
        const detail=document.createElement('p');detail.textContent=place.km.toFixed(1)+' km away (straight line)'+(place.cuisine?' · '+place.cuisine:'')+(place.address?' · '+place.address:'')+(place.hours?' · Hours listed: '+place.hours:'');detail.style.cssText='font-size:12px;opacity:.85;margin:4px 0 8px';
        const directions=document.createElement('button');directions.type='button';directions.textContent='Get directions';directions.onclick=()=>openMap(mapLink(place));
        card.append(name,detail,directions);list.append(card);
      }
      mapChoices.append(list);
      const note=document.createElement('small');note.textContent='Places are from OpenStreetMap, not ranked by customer reviews.';mapChoices.append(note);
    } else if(busy){
      const loading=document.createElement('div');loading.setAttribute('role','status');loading.textContent=phase==='locating'?'Waiting for your location permission…':'Finding nearby suggestions…';loading.style.cssText='padding:16px;text-align:center;opacity:.85';mapChoices.append(loading);
    }
    if(!busy&&!hasResults){
      // No misleading retry loop or repeated options when there are no usable results.
      // For general categories, Maps searches that category; for a named destination it opens directions.
      const destination=navigationTarget||pending||'places nearby';
      popupButton('Get directions',()=>navigationTarget
        ? openDirections(destination)
        : openMap('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(destination+' near me')));
      // One optional discovery action only BEFORE the first lookup, never after failure.
      if(phase==='consent'&&!lookupFailed){
        popupButton('Find nearby suggestions',()=>{
          if(coords){void lookup();return;}
          if(locationApproved&&aurenLocation){coords={lat:aurenLocation.latitude,lon:aurenLocation.longitude};void lookup();return;}
          enable();
        });
      }
    }
    const x=document.createElement('button');x.type='button';x.textContent='Close';x.className='ghost';x.style.cssText='align-self:center;padding:6px 12px';x.onclick=closePopup;mapChoices.append(x);
  }
  const distanceKm=(a,b,c,d)=>{const R=6371,rad=x=>x*Math.PI/180,dl=rad(c-a),dn=rad(d-b),v=Math.sin(dl/2)**2+Math.cos(rad(a))*Math.cos(rad(c))*Math.sin(dn/2)**2;return 2*R*Math.atan2(Math.sqrt(v),Math.sqrt(1-v));};
  // No stored home/address origin: Maps determines device current location when available.
  // Google's Maps URLs support dir_action=navigate with origin omitted.
  function directionsURL(destination){return 'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(destination)+'&travelmode=driving&dir_action=navigate';}
  function openDirections(destination){openMap(directionsURL(destination));}
  const mapLink=(r)=>directionsURL(r.lat+','+r.lon);
  function openMap(url){returnNotice.style.display='none';lastMapClick=Date.now();mapPending=true;returned=false;closePopup();const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';document.body.append(a);a.click();a.remove();}
  // Put the actual clickable Maps link in Text Chat instead of hiding it in Settings.
  // Construct the URL locally; location coordinates reach Google only if the person clicks it.
  function appendMapsLink(query, label='Open results in Google Maps') {
    const url='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(query);
    const wrap=document.createElement('div');wrap.className='msg auren';
    const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';
    link.textContent=label;link.style.cssText='color:#e6c581;text-decoration:underline;font-weight:600;';
    link.addEventListener('click',()=>{lastMapClick=Date.now();mapPending=true;returned=false;});
    wrap.append(link);$('log')?.append(wrap);if($('log'))$('log').scrollTop=$('log').scrollHeight;
    return url;
  }
  function normalizePlaceQuery(text){
    let q=String(text||'').trim().replace(/^(?:hey\s+)?auren[,.! ]*/i,'').replace(/^(?:(?:please|can you|could you|would you)\s+)/i,'').replace(/[.!?]+$/,'').trim();
    const food=/\b(?:places? to eat|somewhere to eat|restaurants?|food|dinner|lunch|breakfast|brunch|where (?:can|should) i eat)\b/i;
    const types=[[/\b(?:coffee shops?|cafes?|coffee)\b/i,'coffee shops'],[/\b(?:parks?|hiking trails?|outdoors|nature)\b/i,'parks'],[/\b(?:gyms?|fitness centers?|workout places?)\b/i,'gyms'],[/\b(?:museums?|art galleries?)\b/i,'museums'],[/\b(?:libraries|library)\b/i,'libraries'],[/\b(?:movie theaters?|cinemas?|movies)\b/i,'movie theaters'],[/\b(?:stores?|shopping|shops?|malls?)\b/i,'stores'],[/\b(?:gas stations?|fuel stations?)\b/i,'gas stations'],[/\b(?:pharmac(?:y|ies)|drugstores?)\b/i,'pharmacies'],[/\b(?:hotels?|places? to stay)\b/i,'hotels'],[/\b(?:barbers?|haircuts?|salons?)\b/i,'barbers'],[/\b(?:car washes?|auto detailing)\b/i,'car washes'],[/\b(?:mechanics?|auto repairs?)\b/i,'mechanics'],[/\b(?:things to do|somewhere to go|places? to visit|fun activities)\b/i,'things to do']];
    // Named brands/destinations stay intact instead of being categorized as generic food.
    if(/^(?:mcdonald'?s|chipotle|starbucks|chick[ -]?fil[ -]?a|taco bell|wendy'?s|burger king|whataburger|subway|dunkin'?|target|walmart)$/i.test(q))return q;
    if(food.test(q))return 'restaurants';
    for(const [pattern,category] of types)if(pattern.test(q))return category;
    q=q.replace(/^(?:find|locate|look for|search for|show|suggest|recommend|take|navigate|go|get|give)\s+(?:me\s+)?(?:directions\s+to\s+|to\s+)?/i,'').replace(/^(?:a|an|the|some|nearby|closest|nearest|good|best)\s+/i,'').replace(/\b(?:near me|nearby|around me|in my area|closest to me)\b/gi,'').trim();
    return q || 'places to visit';
  }
  function mapsQuery(){return pending+' near me';}
  function classifyQuery(input){
    const q=input.toLowerCase();
    const categories=[[/mcdonald|chick.fil|starbucks|walmart|target|costco|whole foods|kroger|walgreens|cvs|best buy|home depot|lowe.s|dunkin|burger king|taco bell/, 'brand'],[/restaurant|eat|dinner|lunch|breakfast|food|pizza|burger|sushi|taco/, 'eat'],[/coffee|cafe|latte|espresso/, 'coffee'],[/park|nature|trail|hike|outdoor/, 'park'],[/gym|fitness|workout/, 'gym'],[/movie|cinema|theater/, 'cinema'],[/museum|gallery|art/, 'museum'],[/library|book/, 'library'],[/bowling|arcade|entertainment|fun|things to do|where should i go|where can i go|places to go/, 'activity'],[/gas|fuel|petrol/, 'gas'],[/pharmacy|drugstore/, 'pharmacy'],[/hotel|lodging/, 'hotel'],[/car wash|detail/, 'carwash'],[/mechanic|auto repair/, 'mechanic'],[/store|shop|mall|buy|grocery|supermarket/, 'shop'],[/barber|haircut|salon/, 'salon']];
    const category=categories.find(([re])=>re.test(q))?.[1]||'activity';
    const branded=q.match(/\b(mcdonald'?s|chick.fil.a|starbucks|walmart|target|costco|whole foods|kroger|walgreens|cvs|best buy|home depot|lowe'?s|dunkin|burger king|taco bell)\b/i)?.[1]||'';
    return {category,branded};
  }
  function selectors(q){const {category,branded}=classifyQuery(q);if(branded)return {regex:'["name"~"'+branded.replace(/'/g,"'?").replace(/\./g,'.')+'",i]',radius:8500};
    const rules={eat:'["amenity"~"restaurant|fast_food|cafe"]',coffee:'["amenity"="cafe"]',park:'["leisure"~"park|nature_reserve|garden"]',gym:'["leisure"="fitness_centre"]',cinema:'["amenity"="cinema"]',museum:'["tourism"~"museum|gallery|attraction"]',library:'["amenity"="library"]',activity:'["tourism"~"attraction|museum|gallery|viewpoint"]',gas:'["amenity"="fuel"]',pharmacy:'["amenity"="pharmacy"]',hotel:'["tourism"~"hotel|motel|guest_house"]',carwash:'["amenity"="car_wash"]',mechanic:'["shop"="car_repair"]',shop:'["shop"]',salon:'["shop"~"hairdresser|beauty"]'};const raw=String(q||'').trim();const named=!/\b(?:restaurant|eat|dinner|lunch|breakfast|food|coffee|cafe|park|gym|museum|library|bowling|arcade|entertainment|fun|things to do|where should|where can|gas|pharmacy|hotel|car wash|mechanic|store|shop|mall|buy|grocery|barber|haircut|salon)\b/i.test(raw) && /^[a-z0-9 &.'-]{2,70}$/i.test(raw);if(named){const safe=raw.replace(/\./g,'\\.').replace(/'/g,"'?");return {regex:'["name"~"'+safe+'",i]',radius:9000};}return {regex:rules[category]||rules.activity,radius:5000};}
  // Speak useful results once. The existing voice listener stays in its normal mode;
  // the person can follow up by number, name, distance, or ask for directions.
  function spokenNearbySummary(){
    if(!results.length)return 'I couldn’t verify nearby listings. Google Maps is available on screen.';
    const named=results.slice(0,3).map((r,i)=>`${i===0?'First':i===1?'Second':'Third'}, ${r.name}, about ${r.km.toFixed(1)} kilometres away`);
    return `I found ${results.length} nearby ${pending} options. ${named.join('. ')}. You can ask which is closest or request directions.`;
  }
  function displayResults(announce=false){
    phase='results';
    showPopup(results.length?`Found ${results.length} nearby ${pending} options. Ask AUREN about any of them.`:`I couldn't verify local ${pending} listings. Google Maps can show more options.`,results);
    hide();
    if(announce){
      void addMessage('auren',spokenNearbySummary());
    }
  }
  function resultByReference(t){
    const q=String(t||'').toLowerCase();
    const numberWords={first:0,one:0,second:1,two:1,third:2,three:2,fourth:3,four:3,fifth:4,five:4,sixth:5,six:5,seventh:6,seven:6,eighth:7,eight:7};
    // Only treat ordinal words as a place reference when the wording points to a result.
    // 'I have two meetings' must never be interpreted as place #2.
    const indexed=q.match(/\b(?:the\s+|number\s+|option\s+|place\s+|result\s+|restaurant\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|[1-8])(?:\s+(?:one|place|result|option|restaurant))?\b/);
    if(indexed){const i=/^[1-8]$/.test(indexed[1])?Number(indexed[1])-1:numberWords[indexed[1]];return results[i]||null;}
    const short=q.match(/^(?:number\s+|option\s+|place\s+)?(one|two|three|four|five|six|seven|eight)[.!? ]*$/);
    if(short)return results[numberWords[short[1]]]||null;
    return results.find(r=>r.name && q.includes(r.name.toLowerCase()))||null;
  }
  async function resultsFollowup(raw){
    if(phase!=='results'||!results.length)return false;
    const t=String(raw||'').trim(), q=t.toLowerCase();
    const list=/\b(?:list|repeat|say|tell)\b.*\b(?:options|places|results|them|again)\b|\bwhat (?:are|were) the (?:options|places|results)\b/i.test(t);
    const closest=/\b(?:which (?:one|place) is (?:the )?(?:closest|nearest)|closest (?:one|place)|nearest (?:one|place))\b/i.test(t);
    const best=/\b(?:best rated|highest rated|top rated|best reviews|highest reviews|ratings|reviews)\b/i.test(t);
    const ref=resultByReference(t);
    // If a numbered choice is requested but does not exist, say so instead of
    // pretending a different place is the intended one.
    const requestedOrdinal=/\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|number\s+[1-8]|(?:place|option|result)\s+[1-8])\b/i.test(t);
    if(requestedOrdinal&&!ref&&/\b(?:directions|take me|navigate|tell me|about|where|how far|open)\b/i.test(t)){
      await addMessage('user',t);
      await addMessage('auren',`I only have ${results.length} nearby result${results.length===1?'':'s'} in this search. Which one would you like?`);
      return true;
    }
    const cheaper=/\b(?:cheaper|less expensive|more affordable|lower priced|budget|inexpensive)\b/i.test(t);
    const better=/\b(?:better|best|highest rated|top rated|reviews|ratings|recommended)\b/i.test(t);
    const more=/\b(?:more options|other places|something else|different options|any others)\b/i.test(t);
    if(cheaper || (better && !/\b(?:best rated|highest rated|top rated|best reviews|highest reviews|ratings|reviews)\b/i.test(t)) || more){
      await addMessage('user',t);
      const search=cheaper?'affordable '+pending:better?'top rated '+pending:pending;
      await addMessage('auren',cheaper
        ? 'I can compare nearby options, but these listings do not contain verified prices. Choose Check affordable options in Maps to compare actual prices and reviews.'
        :better?'I cannot verify which is best from these listings. Choose Compare reviews in Maps for genuine ratings.'
        :'You can explore more results in Google Maps, or ask about one of the places already listed.');
      showPopup('Your earlier nearby places are still available.',results);
      // Keep the popup minimal; the standard directions button and place cards remain available.
      return true;
    }
    const wantsDirections=/\b(?:directions|navigate|take me|go there|route|open maps|how (?:do i|can i) get)\b/i.test(t);
    const asksDetail=/\b(?:tell me|about|how far|distance|where is|what is|which is|the first|the second|the third|number [1-8])\b/i.test(t);
    if(!(list||closest||best||(ref&&(wantsDirections||asksDetail))))return false;
    await addMessage('user',t);
    if(best){
      await addMessage('auren','OpenStreetMap does not provide reliable customer ratings. Select Compare ratings in Google Maps to see actual reviews.');
      popupButton('Compare ratings in Google Maps',()=>openMap('https://www.google.com/maps/search/?api=1&query='+encodeURIComponent('best rated '+mapsQuery())));
      return true;
    }
    if(list){await addMessage('auren',spokenNearbySummary());showPopup('Here are your nearby choices.',results);return true;}
    if(closest){const r=results[0];await addMessage('auren',`${r.name} is the closest of the places I found, about ${r.km.toFixed(1)} kilometres away in a straight line. Driving distance may differ.`);return true;}
    if(ref){
      await addMessage('auren',wantsDirections?`I’ve prepared directions to ${ref.name}. Select Open directions on screen.`:`${ref.name} is about ${ref.km.toFixed(1)} kilometres away in a straight line${ref.cuisine?'. Cuisine: '+ref.cuisine:''}${ref.address?', at '+ref.address:''}${ref.hours?'. Listed hours: '+ref.hours+' (unverified)':''}. Would you like directions?`);
      if(wantsDirections){navigationTarget=ref.name;lastNavigationAt=Date.now();showPopup(`Directions to ${ref.name} are ready.`,results);}
      return true;
    }
    return false;
  }
  function finish(){phase='confirm-done';show('Finish searching?','Are you done with this search? I will clear its temporary coordinates once you confirm.');action('Yes, finish',()=>{clear();void addMessage('auren','Search finished. I cleared the temporary search coordinates.');});action('No, keep searching',()=>displayResults());}
  async function lookup(){
    if(!coords){phase='results';showPopup('Allow location to search nearby places, or open Google Maps.');return;}
    const seq=++requestId, {regex,radius}=selectors(pending),around=`around:${radius},${coords.lat},${coords.lon}`;
    const query=`[out:json][timeout:20];(node(${around})${regex};way(${around})${regex};);out center 80;`;
    lookupFailed=false;phase='searching';showPopup(`Finding nearby ${pending}…`);
    // Try multiple independent public Overpass instances. All are free and unauthenticated;
    // instances can be temporarily unavailable or rate limited.
    const endpoints=[
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://overpass.nchc.org.tw/api/interpreter',
      'https://overpass-api.de/api/interpreter'
    ];
    for(const endpoint of endpoints){
      if(seq!==requestId)return;
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),9500);
      try{
        const response=await fetch(endpoint,{method:'POST',body:new URLSearchParams({data:query}),signal:controller.signal});
        if(!response.ok)throw new Error('Place service unavailable');
        const data=await response.json();if(seq!==requestId)return;
        const seen=new Set();
        const found=(data.elements||[]).map(e=>{
          const t=e.tags||{},lat=e.lat??e.center?.lat,lon=e.lon??e.center?.lon;
          const name=t.name||t.brand||'';
          const cuisine=String(t.cuisine||'').replace(/;/g,', ').slice(0,70);
          const hours=String(t.opening_hours||'').slice(0,90);
          const website=String(t.website||t['contact:website']||'').slice(0,180);
          const address=[t['addr:housenumber'],t['addr:street'],t['addr:city']].filter(Boolean).join(' ');
          return {name,address,cuisine,hours,website,lat,lon,km:Number.isFinite(lat)&&Number.isFinite(lon)?distanceKm(coords.lat,coords.lon,lat,lon):Infinity};
        }).filter(r=>r.name&&Number.isFinite(r.km))
          .sort((a,b)=>a.km-b.km)
          .filter(r=>{const key=r.name.toLowerCase()+'-'+Math.round(r.lat*1000)+'-'+Math.round(r.lon*1000);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,35);
        // Present a useful mix of close options and better-documented locations.
        // This is NOT a rating or review score.
        const selected=[];const selectedNames=new Set();
        for(const r of found){if(selectedNames.has(r.name.toLowerCase()))continue;selected.push(r);selectedNames.add(r.name.toLowerCase());if(selected.length===5)break;}
        for(const r of found){if(selected.includes(r))continue;selected.push(r);if(selected.length===8)break;}
        if(selected.length){results=selected;displayResults(true);return;}
      }catch(err){console.info('AUREN nearby source unavailable',endpoint,err?.message||err);}
      finally{clearTimeout(timer);}
    }
    if(seq!==requestId)return;
    phase='results';results=[];lookupFailed=true;
    showPopup(`I couldn't load verified nearby listings.`);
    await addMessage('auren',`I couldn't verify local ${pending} listings. Google Maps is ready if you'd like to browse.`);
  }
  function enable(){if(!navigator.geolocation){phase='results';showPopup('This browser cannot share a location. Google Maps is still available.');return;}const seq=++requestId;phase='locating';showPopup('Allow location in Safari to see nearby '+pending+'.');
    navigator.geolocation.getCurrentPosition(pos=>{if(seq!==requestId)return;coords={lat:pos.coords.latitude,lon:pos.coords.longitude};void lookup();},()=>{if(seq!==requestId)return;phase='results';showPopup('Location was not available. Try again or use Google Maps.');},{enableHighAccuracy:false,maximumAge:0,timeout:12000});}
  function request(text){
    awaitingPlace=false;requestId++;navigationTarget=destinationFrom(text);if(navigationTarget)lastNavigationAt=Date.now();pending=normalizePlaceQuery(navigationTarget||namedPlaceSearch(text)||text);coords=null;results=[];lookupFailed=false;
    // An optional working Maps search should exist even if the free lookup fails.
    // The popup provides the primary Maps action; no unsolicited chat link.
    if(locationApproved&&aurenLocation){
      coords={lat:aurenLocation.latitude,lon:aurenLocation.longitude};
      phase='consent';showPopup(navigationTarget?'Get directions directly, or choose nearby suggestions.':'Choose how you want to search for '+pending+'.');return;
    }
    phase='consent';showPopup(navigationTarget?'Directions use your current device location in Google Maps if location permission is enabled there. No saved home address is used.':'Choose Nearby places to look up local options, or Google Maps to open a map search.');show('Find places near you?','Would you like to use your location for this search? The search service receives coordinates only if you approve.');action('Allow location & search',enable);action('Not now',clear);
  }
  function isNavigationFollowup(t){
    const c=String(t||'').trim().replace(/^(?:(?:and|then|also|yes|yeah|okay|ok|alright|so)\s*[,.:]?\s+)+/i,'');
    return /^(?:(?:please|can you|could you|would you)\s+)?(?:take me (?:there|to (?:it|there|that place|the place))|yes take me there|go there|navigate (?:there|to it)|get me there|bring me there|drive me there|show me (?:the )?directions|give me (?:the )?directions|open (?:the )?(?:maps|directions)|send me (?:the |their |its )?(?:address|location|directions)|show me (?:their|its) address|how do i get there|how can i get there|where is it)[.!? ]*$/i.test(c);
  }
  function isNavigationOnly(t){
    return /^(?:(?:and|then|also|yes|okay|please)\s+)?(?:(?:take|drive|bring|guide)\s+me\s+to|(?:navigate|directions?)\s+to|(?:give|show|send)\s+(?:me\s+)?(?:the\s+)?directions?\s+to)[.!?, ]*$/i.test(t);
  }
  function isAddressReply(t){
    return /^(?:(?:yes|yeah|okay|ok|please|and|then)\s*[,.:]?\s+)*(?:send (?:me )?(?:their |its |the )?address|send me directions|take me there|open directions|directions please|go there)[.!? ]*$/i.test(t);
  }
  function replyWithDirections(target){
    // The chat link is persistent and works even if a modal was closed.
    phase='consent';navigationTarget=target;pending=target;lastNavigationAt=Date.now();awaitingPlace=false;
    showPopup('Directions are ready for '+target+'. Google Maps will choose your current location when permitted.');
    const url=directionsURL(target);
    const wrap=document.createElement('div');wrap.className='msg auren';
    const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener noreferrer';
    link.textContent='Open directions to '+target+' in Google Maps';
    link.style.cssText='color:#e6c581;font-weight:700;text-decoration:underline;';
    link.addEventListener('click',()=>{lastMapClick=Date.now();mapPending=true;returned=false;closePopup();});
    wrap.append(link);$('log')?.append(wrap);
    if($('log'))$('log').scrollTop=$('log').scrollHeight;
  }
  async function handle(text){const t=String(text||'').trim();
    if(!t)return true;
    const navigation=destinationFrom(t);
    // New explicit intent wins over old follow-ups, including an accidental
    // incomplete voice transcript and ordinary conversation topic switches.
    if(navigation && meaningfulSearchTerm(navigation)){
      await addMessage('user',t);
      request(t);
      replyWithDirections(navigation);
      await addMessage('auren','Directions to '+navigation+' are ready. Select Get directions.');
      return true;
    }
    if(isNavigationOnly(t)||incompletePlaceRequest(t)){
      awaitingPlace=true;
      await addMessage('user',t);
      // Do not speak repeated questions for every partial Safari transcript.
      if(Date.now()-lastPlacePromptAt>12000){lastPlacePromptAt=Date.now();await addMessage('auren','Where would you like to go?');}
      return true;
    }
    // A short answer to our own destination question must become a Maps action.
    if(awaitingPlace && /^(?:[a-z][a-z0-9&’'. -]{1,65})$/i.test(t) && !/^(?:yes|no|cancel|never mind|stop|and|then|also)$/i.test(t) && !/\b(?:what|why|how|can you|could you|would you|my name|schedule|weather|remind|remember|forget|settings|projects)\b/i.test(t)){
      awaitingPlace=false;
      await addMessage('user',t);
      request('take me to '+t);
      replyWithDirections(t);
      await addMessage('auren','Directions to '+t+' are ready. Select Get directions.');
      return true;
    }
    if(awaitingPlace && /^(?:cancel|no|never mind|stop)$/i.test(t)){awaitingPlace=false;return false;}
    // Short-lived navigation follow-ups always take priority over generic AI.
    // Do not reinterpret unrelated later conversations as requests for directions.
    if(navigationTarget && Date.now()-lastNavigationAt<12*60*1000 && (isNavigationFollowup(t)||isAddressReply(t))){
      const target=navigationTarget;
      await addMessage('user',t);
      replyWithDirections(target);
      await addMessage('auren','Directions to '+target+' are ready. Tap Open directions.');
      return true;
    }
    if(/\b(?:turn|switch|disable|stop|clear|forget)\b.*\blocation\b/i.test(t)&&/off|disable|stop|clear|forget/i.test(t)){clear();return false;}
    if(phase==='confirm-done'&&yes.test(t)){await addMessage('user',t);clear();await addMessage('auren','Search finished. Temporary search coordinates cleared.');return true;}
    if(phase==='confirm-done'&&no.test(t)){await addMessage('user',t);displayResults();return true;}
    if(await resultsFollowup(t))return true;
    if((phase==='results'||phase==='confirm-done')&&repeat.test(t)){await addMessage('user',t);displayResults(true);return true;}
    if(phase==='results'&&done.test(t)){await addMessage('user',t);finish();await addMessage('auren','Are you done with this search?');return true;}
    if(phase==='consent'&&yes.test(t)){
      await addMessage('user',t);
      if(locationApproved&&aurenLocation){coords={lat:aurenLocation.latitude,lon:aurenLocation.longitude};await lookup();}
      else {show('Ready to search','Click Allow location & search in Settings to approve Safari location access.');action('Allow location & search',enable);action('Not now',clear);showPopup('Tap Open Google Maps to see your requested destination, or allow location for nearby listings.');await addMessage('auren','Open Maps on screen. Location access is optional.');}
      return true;
    }
    if(phase==='consent'&&no.test(t)){await addMessage('user',t);clear();await addMessage('auren','Of course. I will not use your location.');return true;}
    const destination=destinationFrom(t),named=namedPlaceSearch(t);
    if((destination&&meaningfulSearchTerm(destination))||(named&&meaningfulSearchTerm(named))||placeIntent.test(t)||broadPlaceIntent.test(t)){
      await addMessage('user',t);request(t);
      await addMessage('auren',destination?'Directions are ready. Tap Get directions.':'Choose nearby suggestions or Google Maps reviews.');
      return true;
    }
    return false;
  }
  function onReturn(){if(!mapPending||returned||Date.now()-lastMapClick<1000||Date.now()-lastMapClick>20*60*1000||document.hidden)return;returned=true;mapPending=false;
    if(phase==='results'||phase==='searching'||phase==='consent'){
      closePopup();noticeText.textContent='Back from Maps. Your previous search is still available.';returnNotice.style.display='block';
      // Return notice stays on screen; do not add another chat turn.
    }}
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(onReturn,450);});window.addEventListener('focus',()=>setTimeout(onReturn,450));
  // Location permissions and standing status stay in Settings; results are temporary and belong by the chat.
  return {handle,clear};
})();
