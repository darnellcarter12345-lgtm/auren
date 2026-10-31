// AUREN voice — optional browser speech features; never records or uploads audio itself.
// SpeechRecognition support varies by browser and may use the browser vendor's online service.
export function createVoice({ onTranscript, onStatus }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis || null;
  let recognizer = null;
  let listening = false;
  let enabled = false;
  let generation = 0;
  let wakeMode = false, awaitingCommand = false, speaking = false;
  let restartTimer = null;
  const WAKE = /^(?:hey\s+)?(?:auren|oren|lauren)(?:[\s,.:!?]+|$)/i;

  function status(message) { if (onStatus) onStatus(message); }
  function available() { return { listen: !!Recognition, speak: !!(synth && window.SpeechSynthesisUtterance) }; }
  function voicePick() {
    if (!synth || !synth.getVoices) return null;
    const voices = synth.getVoices();
    return voices.find(v => /^en-GB$/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
  }
  function stopSpeaking() { if (synth) synth.cancel(); speaking = false; }
  function speak(text) {
    if (!enabled || !available().speak || !text) return;
    stopSpeaking();
    if (wakeMode && listening) { stopListening(false); }
    speaking = true; status('Speaking…');
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB'; utterance.rate = 0.96; utterance.pitch = 0.95;
    const voice = voicePick(); if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    utterance.onend = () => { speaking = false; if (wakeMode) scheduleRestart(); else status('Ready.'); };
    utterance.onerror = e => { if (e.error !== 'canceled' && e.error !== 'interrupted') status('Spoken reply failed. Text is still available.'); };
    try { synth.speak(utterance); } catch { status('Speech output is unavailable in this browser.'); }
  }
  function stopListening(disableWake = true) {
    if (disableWake) { wakeMode = false; awaitingCommand = false; }
    clearTimeout(restartTimer);
    generation++;
    if (recognizer) {
      try { recognizer.abort(); } catch { /* stopped already */ }
      recognizer = null;
    }
    listening = false;
    return listening;
  }
  function scheduleRestart() {
    if (!wakeMode || speaking) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { if (wakeMode && !speaking && !listening) startListening(true); }, 600);
  }
  function startListening(fromWake = false) {
    if (!Recognition) { status('Speech recognition is unavailable in this browser. Use the text box instead.'); return false; }
    if (listening) { if (!fromWake) stopListening(); return false; }
    if (!fromWake && !wakeMode) stopSpeaking();
    const myGeneration = ++generation;
    const r = new Recognition(); recognizer = r;
    r.lang = 'en-US'; r.continuous = false; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = event => {
      if (myGeneration !== generation) return;
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (!text) return;
      if (!wakeMode) { onTranscript(text); return; }
      if (awaitingCommand) { awaitingCommand = false; onTranscript(text); return; }
      const match = text.match(WAKE);
      if (!match) { status('Listening for “Hey Auren”…'); return; }
      const command = text.slice(match[0].length).trim();
      if (command) onTranscript(command);
      else { awaitingCommand = true; status('Yes, sir? Listening for your command…'); }
    };
    r.onerror = event => {
      if (myGeneration !== generation) return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') { wakeMode = false; status('Microphone permission denied. Use text instead.'); }
      else if (event.error !== 'aborted' && event.error !== 'no-speech') status('Microphone issue: ' + event.error + '. You can still type.');
    };
    r.onend = () => {
      if (myGeneration !== generation) return;
      listening = false; recognizer = null; if (wakeMode) { status('Listening for “Hey Auren”…'); scheduleRestart(); } else status('Microphone stopped.');
    };
    try { r.start(); listening = true; status('Listening… speak now.'); return true; }
    catch { recognizer = null; listening = false; status('Could not start microphone. Check browser permissions.'); return false; }
  }
  return {
    available, speak, stopSpeaking, startListening, stopListening,
    setWakeMode(value) { wakeMode = !!value && !!Recognition; awaitingCommand = false; if (wakeMode) { if (!listening) startListening(true); } else stopListening(); return wakeMode; },
    get wakeMode() { return wakeMode; },
    get listening() { return listening; },
    get enabled() { return enabled; },
    setEnabled(value) { enabled = !!value; if (!enabled) stopSpeaking(); }
  };
}
