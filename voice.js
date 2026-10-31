// AUREN v1.1: improved foreground wake-phrase recognition and microphone lifecycle.
// SpeechRecognition is browser-dependent and may process microphone audio online.
// The user must explicitly start voice access at least once; no background/locked-screen listening.
export function createVoice({ onTranscript, onStatus }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis || null;
  let recognition = null, active = false, wakeMode = false, conversation = false;
  let speaking = false, responding = false, enabled = false, permittedStart = false;
  let token = 0, restartTimer = null, idleTimer = null, errorStop = false;
  let desiredMode = 'off';
  const SILENCE_MS = 20000;
  // Browser recognition frequently transcribes the invented name AUREN as a
  // familiar name ("Orin", "Oren", "Aaron", "Lauren"). Match short wake
  // phrases, not arbitrary mentions in the middle of other sentences.
  const wakeNames = new Set(['auren','aurin','auron','oren','orin','orren','aaron','erin','lauren','loren','orion']);
  function wordsOf(text) {
    return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  }
  function detectWake(text) {
    const words = wordsOf(text);
    if (!words.length) return null;
    // "Hey, Auren" and speech-engine variations like "hey Lauren".
    // Require the greeting for potentially common names to avoid false wakes.
    const greeting = ['hey','hi','hello','okay','ok'];
    const offset = greeting.includes(words[0]) ? 1 : 0;
    const candidate = words[offset];
    if (!wakeNames.has(candidate)) return null;
    if (!offset && candidate !== 'auren' && candidate !== 'aurin' && candidate !== 'auron') return null;
    // Without a greeting, only allow a standalone name or a short direct command.
    if (!offset && words.length > 1 && !['can','could','please','tell','what','remind','remember','help','how','do'].includes(words[1])) return null;
    return { command: words.slice(offset+1).join(' ') };
  }

  const report = text => onStatus?.(text);
  const available = () => ({ listen: !!Recognition, speak: !!(synth && window.SpeechSynthesisUtterance) });
  const cancelTimers = () => { clearTimeout(restartTimer); clearTimeout(idleTimer); };
  const abort = () => { const old = recognition; recognition = null; active = false; if (old) try { old.abort(); } catch {} };
  const voicePick = () => {
    const voices = synth?.getVoices?.() || [];
    return voices.find(v => /^en-GB$/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
  };
  function scheduleIdle() {
    clearTimeout(idleTimer);
    if (conversation && wakeMode) idleTimer = setTimeout(() => {
      conversation = false;
      report('Conversation paused after silence. Say “Hey Auren” to resume.');
    }, SILENCE_MS);
    else if (conversation) idleTimer = setTimeout(() => {
      stopListening(); report('Conversation ended after silence. Tap the orb to speak again.');
    }, SILENCE_MS);
  }
  function listenSoon(delay = 200) {
    clearTimeout(restartTimer);
    if (desiredMode === 'off' || (!wakeMode && !conversation) || speaking || responding || !permittedStart || errorStop || active || !Recognition) return;
    restartTimer = setTimeout(startEngine, delay);
  }
  function startEngine() {
    if (desiredMode === 'off' || active || speaking || responding || errorStop || (!conversation && !wakeMode) || !permittedStart) return;
    const id = ++token;
    const r = new Recognition(); recognition = r;
    r.lang = 'en-US'; r.continuous = false; r.interimResults = false; r.maxAlternatives = 5;
    r.onresult = event => {
      if (id !== token) return;
      const alternatives = [...event.results].flatMap(item => Array.from(item).map(a => a.transcript?.trim()).filter(Boolean));
      const transcript = alternatives[0] || '';
      if (!transcript) return;
      // Choose the first alternative containing a valid wake phrase.
      const detected = alternatives.map(detectWake).find(Boolean);
      clearTimeout(idleTimer);
      responding = true;
      if (wakeMode && !conversation && !detected) {
        responding = false; listenSoon(350); return;
      }
      if (detected) {
        conversation = true;
        const command = detected.command;
        if (!command) {
          report('AUREN activated. Listening for your request…');
          speak('Yes, sir?');
          responding = false;
          if (!speaking) { scheduleIdle(); listenSoon(350); }
          return;
        }
        deliver(command);
      } else if (conversation) deliver(transcript);
      else { responding = false; listenSoon(350); }
    };
    r.onerror = e => {
      if (id !== token) return;
      if (['not-allowed','service-not-allowed','audio-capture'].includes(e.error)) {
        errorStop = true; wakeMode = false; conversation = false; desiredMode = 'off'; permittedStart = false;
        report('Microphone unavailable (' + e.error + '). Enable access and tap the orb again.');
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        report('Voice recognition issue: ' + e.error + '.');
      }
    };
    r.onend = () => {
      if (id !== token) return;
      recognition = null; active = false;
      if (!responding && !speaking && !errorStop) listenSoon(450);
    };
    try { r.start(); active = true; report(conversation ? 'Listening for your next question…' : 'Listening for “Hey Auren”…'); }
    catch { active = false; recognition = null; report('Could not start listening. Tap the orb to retry.'); }
  }
  async function deliver(text) {
    try { await onTranscript?.(text); }
    catch { report('I could not process that request.'); }
    finally {
      responding = false;
      scheduleIdle();
      if (!speaking) listenSoon(400);
    }
  }
  function stopSpeaking() {
    if (synth) synth.cancel();
    speaking = false;
    if (!responding) listenSoon(350);
  }
  function speak(text) {
    if (!enabled || !available().speak || !text) return;
    abort(); // suppress microphone feedback from AUREN's own voice
    if (synth) synth.cancel();
    speaking = true;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB'; u.rate = .96; u.pitch = .95;
    const chosen = voicePick(); if (chosen) { u.voice = chosen; u.lang = chosen.lang; }
    u.onend = () => { speaking = false; scheduleIdle(); if (!responding) listenSoon(420); };
    u.onerror = () => { speaking = false; report('Voice output stopped; text remains available.'); if (!responding) listenSoon(420); };
    try { synth.speak(u); report('AUREN speaking…'); }
    catch { speaking = false; report('Speech output unavailable.'); if (!responding) listenSoon(); }
  }
  function startListening() {
    if (!Recognition) { report('Speech recognition is unsupported here.'); return false; }
    if (conversation && !wakeMode) { stopListening(); return false; }
    errorStop = false; permittedStart = true; conversation = true; desiredMode = 'conversation';
    clearTimeout(idleTimer); if (speaking) stopSpeaking();
    scheduleIdle(); listenSoon(0);
    return true;
  }
  function stopListening() {
    wakeMode = false; conversation = false; responding = false; permittedStart = false; desiredMode = 'off';
    cancelTimers(); ++token; abort();
    report('Microphone off. Tap the orb to speak.'); return false;
  }
  function setWakeMode(value) {
    if (!value) { stopListening(); return false; }
    if (!Recognition) { report('Wake phrase unavailable in this browser.'); return false; }
    // This must be called by a user interaction to receive microphone permission.
    errorStop = false; permittedStart = true; wakeMode = true; conversation = false; desiredMode = 'wake';
    cancelTimers(); if (speaking) stopSpeaking();
    listenSoon(0); report('Listening for “Hey Auren” while this page is active.');
    return true;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(restartTimer); ++token; abort(); report('Voice paused while AUREN is in the background.'); }
    else if (permittedStart && (wakeMode || conversation) && !errorStop) listenSoon(350);
  });
  return {
    available, speak, stopSpeaking, startListening, stopListening, setWakeMode,
    get listening() { return desiredMode !== 'off'; },
    get wakeMode() { return wakeMode; },
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; if (!enabled) stopSpeaking(); }
  };
}
