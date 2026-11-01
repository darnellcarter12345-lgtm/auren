
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
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const butler = new Butler();
const settings = loadSettings();
const HISTORY_LIMIT = 200;
const aiRecent = [];

const aiEndpointInput = $('aiEndpoint');
aiEndpointInput.value = getAIEndpoint();

$('saveAIEndpoint').onclick = () => {
  try {
    setAIEndpoint(aiEndpointInput.value);
    showStatus('AUREN AI connection saved on this browser.', 'ok');
  } catch (e) {
    showStatus(e.message, 'error');
  }
};

$('clearAIEndpoint').onclick = () => {
  setAIEndpoint('');
  aiEndpointInput.value = '';
  showStatus('AI connection removed.', 'info');
};

let storageOk = false, sinceTrim = 0;

const voice = createVoice({
  onInterim: partial => {
    $('liveTranscript').textContent = partial ? 'You: ' + partial : '';
    $('liveTranscript').hidden = !partial;
  },
  onSpoken: (progress, full) => {
    $('liveTranscript').textContent = 'AUREN: ' + progress;
    $('liveTranscript').hidden = false;
    $('aurenHeadline').textContent = progress || 'Speaking…';
  },
  onHeard: text => {
    $('liveTranscript').textContent = 'You: ' + text;
    $('liveTranscript').hidden = false;
  },
  onTranscript: async transcript => {
    $('chatInput').value = transcript;
    try {
      await send(transcript);
    } catch (error) {
      console.error('AUREN conversation request failed', error);
      showStatus('Voice request failed: ' + (error?.message || 'Unknown error'), 'error');
      throw error;
    }
  },
  onStatus: msg => {
    $('voiceStatus').textContent = msg;
    queueMicrotask(() => syncVoiceUI());
  }
});

function syncVoiceUI() {
  const listening = voice.listening;
  $('micBtn').textContent = listening ? '■ Stop listening' : '🎙 Speak to AUREN';
  $('micBtn').setAttribute('aria-pressed', String(listening));

  $('wakeBtn').textContent = voice.wakeMode
    ? '■ Stop “Hey Auren”'
    : 'Enable “Hey Auren”';

  $('wakeBtn').setAttribute('aria-pressed', String(voice.wakeMode));

  const message = $('voiceStatus').textContent || '';
  const speaking = voice.speaking || /AUREN speaking|speaking…/i.test(message);
  const thinking = /thinking|processing|requesting/i.test(message)
    || $('latestReply').textContent === 'Thinking…';

  const waitingWake = voice.wakeMode && !listening && !speaking && !thinking;
  const state = speaking ? 'speaking'
    : thinking ? 'processing'
    : listening ? 'listening'
    : 'idle';

  document.body.dataset.voiceState = state;

  $('heroState').textContent = speaking
    ? 'AUREN is speaking'
    : thinking ? 'AUREN is thinking'
    : listening ? (voice.wakeMode ? 'AUREN is listening' : 'Listening')
    : waitingWake ? 'Wake mode ready'
    : 'AUREN is asleep';

  $('wakeHint').hidden = speaking || thinking || listening;

  if (state === 'idle') $('aurenHeadline').textContent = 'At your service.';
  else if (state === 'listening') $('aurenHeadline').textContent = 'I’m listening.';
  else if (state === 'processing') $('aurenHeadline').textContent = 'One moment.';
  else if (state === 'speaking' && !voice.speaking) {
    $('aurenHeadline').textContent = 'Speaking…';
  }
}

const capabilities = voice.available();
$('micBtn').disabled = !capabilities.listen;
$('speakReplies').disabled = !capabilities.speak;
$('stopSpeech').disabled = !capabilities.speak;

$('voiceStatus').textContent = capabilities.listen
  ? 'Tap the microphone to dictate a command.'
  : 'Microphone recognition unavailable in this browser; typing works.';

$('micBtn').onclick = () => {
  if (voice.listening) voice.stopListening();
  else voice.startListening();
  syncVoiceUI();
};

$('speakReplies').onchange = () => voice.setEnabled($('speakReplies').checked);
$('stopSpeech').onclick = () => voice.stopSpeaking();

const advancedNav = $('advancedNav');

$('panelToggle').onclick = () => {
  const isSettings = $('settings').classList.contains('active');
  const target = isSettings ? 'chat' : 'settings';

  advancedNav.hidden = isSettings;
  $('panelToggle').setAttribute('aria-expanded', String(!isSettings));

  const tab = document.querySelector(`nav button[data-tab="${target}"]`);
  if (tab) tab.click();
};

let lastOrbTap = 0;

$('orbControl').onclick = () => {
  const now = Date.now();
  if (now - lastOrbTap < 650) return;
  lastOrbTap = now;

  if (capabilities.speak) {
    voice.setEnabled(true);
    $('speakReplies').checked = true;
  }

  if (voice.speaking) {
    voice.stopSpeaking();
    voice.stopListening();
    voice.startListening();
  } else {
    $('micBtn').click();
  }

  syncVoiceUI();
};

$('testVoice').hidden = true;
$('testVoice').onclick = null;

$('wakeBtn').onclick = () => {
  if (capabilities.speak) voice.setEnabled(true);

  const active = voice.setWakeMode(!voice.wakeMode);

  if (active) voice.setEnabled(true);
  $('speakReplies').checked = voice.enabled;
  syncVoiceUI();
};

const VOICE_PREFS_KEY = 'auren_voice_prefs_v12';
let savedWake = false;

try {
  savedWake = !!JSON.parse(localStorage.getItem(VOICE_PREFS_KEY) || '{}').wake;
} catch {}

function saveWakePreference() {
  try {
    localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify({ wake: savedWake }));
  } catch {}
}

voice.setVoicePreference('');
voice.setVoiceStyle({ rate: 0.94, pitch: 0.96 });

const voiceCard = document.createElement('div');
voiceCard.className = 'card';

const voiceHeading = document.createElement('h3');
voiceHeading.textContent = 'AUREN voice';

const voiceDescription = document.createElement('p');
voiceDescription.className = 'hint';
voiceDescription.textContent =
  'One automatically selected British-butler voice. The sound depends on which voices Safari and macOS provide.';

voiceCard.append(voiceHeading, voiceDescription);

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

  try {
    localStorage.setItem(INTERRUPTIONS_KEY, String(value));
  } catch {
    showStatus('This browser could not save the interruption preference.', 'error');
  }

  syncInterruptionsHelp();

  showStatus(
    value
      ? 'Interruptions on. AUREN may pause for nearby speech.'
      : 'Interruptions off. AUREN will finish each reply.',
    'info'
  );
});

syncInterruptionsHelp();
voiceCard.append(interruptRow, interruptHelp);

$('wakeBtn').textContent = 'Enable “Hey Auren”';
$('settings').insertBefore(voiceCard, $('settings').firstElementChild);

const settingsPanel = $('settings');
const aiConnectionCard = aiEndpointInput.closest('.card');
const aiReady = !!getAIEndpoint();

if (aiReady) {
  aiConnectionCard.hidden = true;
  aiConnectionCard.style.display = 'none';
} else {
  aiConnectionCard.querySelector('h3').textContent = 'Finish setup';
  aiConnectionCard.querySelector('p').textContent =
    'AUREN needs its AI connection before it can answer general questions.';
  $('clearAIEndpoint').hidden = true;
}

const simpleConnection = document.createElement('p');
simpleConnection.className = 'hint';
simpleConnection.textContent = aiReady
  ? 'AI connection ready'
  : 'AI connection not yet set up';

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
dataIntro.textContent =
  'AUREN remembers information on this device. Here you can save a copy, restore it, or manage privacy.';

privateDetails.append(dataIntro);

const storageCards = [...settingsPanel.querySelectorAll(':scope > .card')]
  .filter(card => card !== voiceCard && card !== aiConnectionCard);

for (const card of storageCards) privateDetails.append(card);
settingsPanel.append(privateDetails);

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
  $('voiceStatus').textContent =
    'Hey Auren is saved. Tap Enable “Hey Auren” once to activate the microphone.';
  $('wakeBtn').textContent = 'Resume “Hey Auren”';
}

const observer = new MutationObserver(syncVoiceUI);
observer.observe($('voiceStatus'), {
  childList: true,
  characterData: true,
  subtree: true
});
