// AUREN voice — optional browser speech features; never records or uploads audio itself.
// SpeechRecognition support varies by browser and may use the browser vendor's online service.
export function createVoice({ onTranscript, onStatus }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis || null;
  let recognizer = null;
  let listening = false;
  let enabled = false;
  let generation = 0;

  function status(message) { if (onStatus) onStatus(message); }
  function available() { return { listen: !!Recognition, speak: !!(synth && window.SpeechSynthesisUtterance) }; }
  function voicePick() {
    if (!synth || !synth.getVoices) return null;
    const voices = synth.getVoices();
    return voices.find(v => /^en-GB$/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
  }
  function stopSpeaking() { if (synth) synth.cancel(); }
  function speak(text) {
    if (!enabled || !available().speak || !text) return;
    stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-GB'; utterance.rate = 0.96; utterance.pitch = 0.95;
    const voice = voicePick(); if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
    utterance.onerror = e => { if (e.error !== 'canceled' && e.error !== 'interrupted') status('Spoken reply failed. Text is still available.'); };
    try { synth.speak(utterance); } catch { status('Speech output is unavailable in this browser.'); }
  }
  function stopListening() {
    generation++;
    if (recognizer) {
      try { recognizer.abort(); } catch { /* stopped already */ }
      recognizer = null;
    }
    listening = false;
    return listening;
  }
  function startListening() {
    if (!Recognition) { status('Speech recognition is unavailable in this browser. Use the text box instead.'); return false; }
    if (listening) { stopListening(); return false; }
    stopSpeaking();
    const myGeneration = ++generation;
    const r = new Recognition(); recognizer = r;
    r.lang = 'en-US'; r.continuous = false; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = event => {
      if (myGeneration !== generation) return;
      const text = event.results?.[0]?.[0]?.transcript?.trim();
      if (text) onTranscript(text);
    };
    r.onerror = event => {
      if (myGeneration !== generation) return;
      if (event.error !== 'aborted' && event.error !== 'no-speech') status('Microphone issue: ' + event.error + '. You can still type.');
    };
    r.onend = () => {
      if (myGeneration !== generation) return;
      listening = false; recognizer = null; status('Microphone stopped.');
    };
    try { r.start(); listening = true; status('Listening… speak now.'); return true; }
    catch { recognizer = null; listening = false; status('Could not start microphone. Check browser permissions.'); return false; }
  }
  return {
    available, speak, stopSpeaking, startListening, stopListening,
    get listening() { return listening; },
    get enabled() { return enabled; },
    setEnabled(value) { enabled = !!value; if (!enabled) stopSpeaking(); }
  };
}
