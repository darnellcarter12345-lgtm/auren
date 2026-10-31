// AUREN v0.9: foreground voice dialogue and optional wake phrase.
// SpeechRecognition is browser-dependent and may process microphone audio online.
// The user must explicitly start voice access at least once; no background/locked-screen listening.
export function createVoice({ onTranscript, onStatus }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis || null;
  let recognition = null, active = false, wakeMode = false, conversation = false;
  let speaking = false, responding = false, enabled = false, permittedStart = false;
  let token = 0, restartTimer = null, idleTimer = null, errorStop = false;
  const SILENCE_MS = 20000;
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
    if ((!wakeMode && !conversation) || speaking || responding || !permittedStart || errorStop || active || !Recognition) return;
    restartTimer = setTimeout(startEngine, delay);
  }
  function startEngine() {
    if (active || speaking || responding || errorStop || (!conversation && !wakeMode) || !permittedStart) return;
    const id = ++token;
    const r = new Recognition(); recognition = r;
    r.lang = 'en-US'; r.continuous = false; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = event => {
      if (id !== token) return;
      const transcript = [...event.results].map(item => item[0]?.transcript || '').join(' ').trim();
      if (!transcript) return;
      clearTimeout(idleTimer);
      // Never listen while replying or speaking back.
      responding = true;
      const match = transcript.match(/\b(?:hey\s+)?(?:auren|orin|orren|oren|lauren)\b[\s,!.?]*/i);
      if (wakeMode && !conversation && !match) {
        responding = false; listenSoon(350); return;
      }
      if (match) {
        conversation = true;
        const command = transcript.slice(match.index + match[0].length).trim();
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
        errorStop = true; wakeMode = false; conversation = false;
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
    errorStop = false; permittedStart = true; conversation = true;
    clearTimeout(idleTimer); if (speaking) stopSpeaking();
    scheduleIdle(); listenSoon(0);
    return true;
  }
  function stopListening() {
    wakeMode = false; conversation = false; responding = false; permittedStart = false;
    cancelTimers(); ++token; abort();
    report('Microphone stopped.'); return false;
  }
  function setWakeMode(value) {
    if (!value) { stopListening(); return false; }
    if (!Recognition) { report('Wake phrase unavailable in this browser.'); return false; }
    // This must be called by a user interaction to receive microphone permission.
    errorStop = false; permittedStart = true; wakeMode = true; conversation = false;
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
    get listening() { return active || wakeMode || conversation; },
    get wakeMode() { return wakeMode; },
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; if (!enabled) stopSpeaking(); }
  };
}
