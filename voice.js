// AUREN v1.1: improved foreground wake-phrase recognition and microphone lifecycle.
// SpeechRecognition is browser-dependent and may process microphone audio online.
// The user must explicitly start voice access at least once; no background/locked-screen listening.
export function createVoice({ onTranscript, onStatus, onInterim, onHeard, onSpoken }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis || null;
  let recognition = null, active = false, wakeMode = false, conversation = false;
  let speaking = false, responding = false, enabled = false, permittedStart = false;
  let token = 0, restartTimer = null, idleTimer = null, errorStop = false;
  let desiredMode = 'off';
  let currentUtterance = null;
  let fixedVoice = null;
  let spokenText = '';
  let interrupted = false;
  let interruptionsEnabled = false; // Privacy-conscious default: background voices cannot interrupt.
  let preferredVoiceURI = ''; let voiceRate = 0.96, voicePitch = 0.95; 
  const SILENCE_MS = 45000;
  // Browser recognition frequently transcribes the invented name AUREN as a
  // familiar name ("Orin", "Oren", "Aaron", "Lauren"). Match short wake
  // phrases, not arbitrary mentions in the middle of other sentences.
  const wakeNames = new Set(['auren','aurin','auron','oren','orin','orren','aaron','aron','erin','lauren','loren','orion','orin']);
  function wordsOf(text) {
    return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  }
  function detectWake(text) {
    const words = wordsOf(text);
    if (!words.length) return null;
    // "Hey, Auren" and speech-engine variations like "hey Lauren".
    // Require the greeting for potentially common names to avoid false wakes.
    const greeting = ['hey','hi','hello','okay','ok','yo'];
    const offset = greeting.includes(words[0]) ? 1 : 0;
    let candidate = words[offset];
    let nameLength = 1;
    // Safari occasionally splits the spoken name 'Or-en' into two words.
    if (['or','aur','ore'].includes(candidate) && ['en','in','an'].includes(words[offset+1])) { candidate = 'oren'; nameLength = 2; }
    if (!wakeNames.has(candidate)) return null;
    if (!offset && candidate !== 'auren' && candidate !== 'aurin' && candidate !== 'auron') return null;
    // Without a greeting, only allow a standalone name or a short direct command.
    if (!offset && words.length > nameLength && !['can','could','please','tell','what','remind','remember','help','how','do'].includes(words[nameLength])) return null;
    return { command: words.slice(offset+nameLength).join(' ') };
  }

  function normalizeWakeDisplay(text) {
    // Normalize only the invocation, never ordinary references to people named Aaron.
    const words = String(text || '').trim().split(/\s+/);
    const detected = detectWake(text);
    if (!detected) return String(text || '').trim();
    const prefix = /^(hey|hi|hello|okay|ok|yo)\b/i.test(words[0] || '') ? 'Hey ' : '';
    return prefix + 'Auren' + (detected.command ? ' ' + detected.command : '');
  }
  const report = text => onStatus?.(text);
  const available = () => ({ listen: !!Recognition, speak: !!(synth && window.SpeechSynthesisUtterance) });
  const cancelTimers = () => { clearTimeout(restartTimer); clearTimeout(idleTimer); };
  const abort = () => { const old = recognition; recognition = null; active = false; if (old) try { old.abort(); } catch {} };
  // Pick one sophisticated British voice without exposing a confusing voice menu.
  // Prefer macOS enhanced/premium voices when installed; avoid novelty voices.
  const voicePick = () => {
    if (fixedVoice) return fixedVoice;
    const voices = synth?.getVoices?.() || [];
    if (preferredVoiceURI) {
      const explicit = voices.find(v => v.voiceURI === preferredVoiceURI);
      if (explicit) return explicit;
    }
    const isEnglish = v => /^en(?:-|$)/i.test(v.lang);
    const novelty = /bad news|good news|bells|bubbles|whisper|zarvox|trinoids|cellos|boing|organ|bahh|albert|fred|hysterical|jester|wobble|robot|novelty/i;
    const candidates = voices.filter(v => isEnglish(v) && !novelty.test(v.name));
    const score = v => {
      const name = v.name || '';
      let n = /^en-GB$/i.test(v.lang) ? 100 : /^en-(IE|AU|NZ)$/i.test(v.lang) ? 30 : 0;
      if (v.localService) n += 8;
      if (/premium|enhanced|natural|neural/i.test(name)) n += 35;
      if (/daniel|oliver|arthur|george|jamie|ryan|alabaster/i.test(name)) n += 25;
      if (/siri/i.test(name)) n += 10;
      if (/female|child/i.test(name)) n -= 15;
      return n;
    };
    const chosen = candidates.sort((a,b) => score(b)-score(a))[0] || null;
    // Never switch between voices during the session, especially when Safari
    // populates voices late or offers novelty-only fallbacks.
    if (chosen) fixedVoice = chosen;
    return fixedVoice;
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
    if (desiredMode === 'off' || (!wakeMode && !conversation) || (speaking && (!conversation || !interruptionsEnabled)) || responding || !permittedStart || errorStop || active || !Recognition) return;
    restartTimer = setTimeout(startEngine, delay);
  }
  function startEngine() {
    if (desiredMode === 'off' || active || (speaking && (!conversation || !interruptionsEnabled)) || responding || errorStop || (!conversation && !wakeMode) || !permittedStart) return;
    const id = ++token;
    const r = new Recognition(); recognition = r;
    r.lang = 'en-GB'; r.continuous = false; r.interimResults = true; r.maxAlternatives = 5;
    r.onresult = event => {
      if (id !== token) return;
      const finalResults = [];
      const interim = [];
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalResults.push(result);
        else if (result[0]?.transcript) interim.push(result[0].transcript.trim());
      }
      if (interim.length) {
        const preview = interim.join(' ').trim();
        if (!speaking && (!wakeMode || conversation || detectWake(preview))) onInterim?.(normalizeWakeDisplay(preview));
      }
      if (!finalResults.length || responding) return;
      const alternatives = finalResults.flatMap(item => Array.from(item).map(a => a.transcript?.trim()).filter(Boolean));
      const transcript = alternatives[0] || '';
      if (!transcript) return;
      if (speaking) {
        if (!interruptionsEnabled) return;
        // Safari may hear its own speakers. Only interrupt for a clear, distinct
        // utterance; a wake phrase always counts. Others need 3+ words and
        // must not be a fragment of what AUREN is currently saying.
        const cleaned = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        const output = spokenText.toLowerCase().replace(/[^a-z0-9 ]/g, '');
        const wake = alternatives.map(detectWake).find(Boolean);
        if (!wake && (cleaned.split(/\s+/).length < 3 || output.includes(cleaned))) return;
        interrupted = true;
        if (synth) synth.cancel();
        currentUtterance = null;
        speaking = false;
        spokenText = '';
        report('Interrupted — listening to you…');
        onInterim?.('');
        // Continue below through the exact same transcript pipeline as orb mode.
      }
      const detected = alternatives.map(detectWake).find(Boolean);
      const visibleTranscript = detected ? normalizeWakeDisplay(alternatives.find(a => detectWake(a)) || transcript) : transcript;
      if (wakeMode && !conversation && !detected) { onInterim?.(''); return; }
      clearTimeout(idleTimer);
      responding = true;
      onInterim?.('');
      if (detected) {
        conversation = true;
        if (!detected.command) {
          responding = false;
          report('Listening — go ahead…');
          // Don't speak after just the wake phrase: it would interrupt the next request.
          scheduleIdle();
          return;
        }
        onHeard?.(visibleTranscript);
        deliver(detected.command);
      } else if (conversation) {
        onHeard?.(visibleTranscript);
        deliver(transcript);
      } else responding = false;
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
      if (!responding && !errorStop) listenSoon(450);
    };
    try { r.start(); active = true; report(conversation ? 'Listening…' : 'Say “Hey Auren” to speak'); }
    catch { active = false; recognition = null; report('Could not start listening. Tap the orb to retry.'); }
  }
  async function deliver(text) {
    try { report('Thinking…'); await onTranscript?.(text); }
    catch (error) {
      // Do not hide the actual failure behind a generic message.
      console.error('AUREN request failed', error);
      report('Request error: ' + (error?.message || 'Unknown issue') + '. You can try again.');
    }
    finally {
      responding = false;
      scheduleIdle();
      if (!speaking) listenSoon(400);
    }
  }
  function stopSpeaking() {
    if (synth) synth.cancel();
    currentUtterance = null;
    speaking = false; spokenText = '';
    if (!responding) listenSoon(350);
  }
  function speak(text) {
    if (!enabled || !available().speak || !text) return;
    // A fresh answer replaces prior speech; stop timers/recognition only once.
    // Keep recognition running during speech where Safari permits, so the user
    // can interrupt. Spoken-voice echo is filtered in the recognition handler.
    if (!conversation || !interruptionsEnabled) abort();
    if (synth) synth.cancel();
    speaking = true; interrupted = false; spokenText = text;
    const u = new SpeechSynthesisUtterance(text);
    currentUtterance = u; // Keep a strong reference; Safari may drop async utterances.
    u.lang = 'en-GB'; u.rate = voiceRate; u.pitch = voicePitch;
    const chosen = voicePick(); if (chosen) { u.voice = chosen; u.lang = chosen.lang; }
    u.onstart = () => { if (currentUtterance !== u) return; onSpoken?.(text, text); report('AUREN speaking…'); };
    u.onboundary = e => { if (currentUtterance !== u) return;
      // Safari supplies word boundaries on some voices but not all.
      if (Number.isInteger(e.charIndex) && e.charIndex >= 0) {
        const end = Math.min(text.length, e.charIndex + (e.charLength || 1));
        onSpoken?.(text.slice(0, end), text);
      }
    };
    u.onend = () => { if (currentUtterance !== u) return; spokenText = ''; onSpoken?.(text, text); if (currentUtterance === u) currentUtterance = null; speaking = false; report(wakeMode ? 'Listening — ask a follow-up, or say “Hey Auren”' : (conversation ? 'Listening for your next question…' : 'Tap the orb to speak')); scheduleIdle(); if (!responding) listenSoon(250); };
    u.onerror = () => { if (currentUtterance !== u) return; spokenText = ''; if (currentUtterance === u) currentUtterance = null; speaking = false; report('Voice output stopped; text remains available.'); if (!responding) listenSoon(420); };
    try { synth.speak(u); report('AUREN speaking…'); if (interruptionsEnabled && conversation && !active && !responding) listenSoon(250); }
    catch { currentUtterance = null; speaking = false; report('Speech output unavailable.'); if (!responding) listenSoon(); }
  }
  function startListening() {
    if (!Recognition) { report('Speech recognition is unsupported here.'); return false; }
    if (conversation && !wakeMode) { stopListening(); return false; }
    errorStop = false; permittedStart = true; conversation = true; desiredMode = 'conversation';
    clearTimeout(idleTimer); if (speaking) stopSpeaking();
    scheduleIdle(); startEngine(); // Must run synchronously in the user's click on Safari.
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
    startEngine(); // Safari requires this within the user's activation.
    if (active) report('Listening for “Hey Auren” while this page is active.');
    return true;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(restartTimer); ++token; abort(); report('Voice paused while AUREN is in the background.'); }
    else if (permittedStart && (wakeMode || conversation) && !errorStop) listenSoon(350);
  });
  return {
    available, speak, stopSpeaking, startListening, stopListening, setWakeMode,
    getVoices() { return synth?.getVoices?.() || []; },
    setVoicePreference(uri) { preferredVoiceURI = String(uri || ""); fixedVoice = null; },
    setVoiceStyle({ rate, pitch } = {}) {
      if (Number.isFinite(Number(rate))) voiceRate = Math.max(0.7, Math.min(1.25, Number(rate)));
      if (Number.isFinite(Number(pitch))) voicePitch = Math.max(0.7, Math.min(1.3, Number(pitch)));
    },
    get listening() { return desiredMode !== 'off'; },
    get speaking() { return speaking; },
    get wakeMode() { return wakeMode; },
    get enabled() { return enabled; },
    get interruptionsEnabled() { return interruptionsEnabled; },
    setInterruptionsEnabled(value) {
      interruptionsEnabled = !!value;
      // Switching OFF immediately halts microphone recognition during playback.
      // It resumes only after AUREN finishes talking.
      if (!interruptionsEnabled && speaking) { ++token; abort(); clearTimeout(restartTimer); }
      // Switching ON is best-effort; never auto-request microphone permissions.
      if (interruptionsEnabled && speaking && permittedStart && conversation && !responding) listenSoon(250);
      return interruptionsEnabled;
    },
    setEnabled(v) { enabled = !!v; if (!enabled) stopSpeaking(); }
  };
}
