// AUREN v1.1: improved foreground wake-phrase recognition and microphone lifecycle.
// SpeechRecognition is browser-dependent and may process microphone audio online.
// The user must explicitly start voice access at least once; no background/locked-screen listening.
export function createVoice({ onTranscript, onStatus, onInterim, onHeard, onSpoken }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  // iPhone/iPad WebKit can stop long-running recognition or reject automatic restarts.
  // Keep sessions short on touch iOS devices, rearming while the tab stays visible.
  const mobileWebKit = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pageVisible = () => document.visibilityState === 'visible';
  let restartFailures = 0;
  let lastStart = 0;
  const synth = window.speechSynthesis || null;
  let recognition = null, active = false, engineRunning = false, wakeMode = false, conversation = false;
  let speaking = false, responding = false, enabled = false, permittedStart = false;
  let token = 0, restartTimer = null, idleTimer = null, errorStop = false;
  let desiredMode = 'off';
  // Aggregate recognition fragments until the speaker pauses naturally.
  let phraseParts = [], phraseTimer = null;
  const PHRASE_PAUSE_MS = mobileWebKit ? 1350 : 1050;
  function clearPhrase() { clearTimeout(phraseTimer); phraseTimer = null; phraseParts = []; }
  function queuePhrase(text) {
    if (!text) return;
    phraseParts.push(text.trim());
    schedulePhrase();
  }
  function schedulePhrase() {
    clearTimeout(phraseTimer);
    if (!phraseParts.length) return;
    phraseTimer = setTimeout(() => {
      phraseTimer = null;
      const text = phraseParts.join(' ').trim();
      phraseParts = [];
      if (text) processPhrase(text);
    }, PHRASE_PAUSE_MS);
  }
  let currentUtterance = null;
  let fixedVoice = null;
  let audioPrimed = false;
  let spokenText = '';
  let interrupted = false;
  let interruptionsEnabled = false; // Privacy-conscious default: background voices cannot interrupt.
  let interruptionCandidate = '', interruptionSamples = 0;
  let preferredVoiceURI = ''; let voiceRate = 0.96, voicePitch = 0.95; 
  // Return to wake-only mode shortly after the last interaction.
  const SILENCE_MS = 8500;
  // Browser recognition frequently transcribes the invented name AUREN as a
  // familiar name ("Orin", "Oren", "Aaron", "Lauren"). Match short wake
  // phrases, not arbitrary mentions in the middle of other sentences.
  const wakeNames = new Set(['auren','aurin','auron','oren','orin','orren','aaron','aron','erin','lauren','loren','orion','ohrin','auren']);
  function wordsOf(text) {
    return text.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean);
  }
  function detectWake(text) {
    const words = wordsOf(text);
    if (!words.length) return null;
    // "Hey, Auren" and speech-engine variations like "hey Lauren".
    // Require the greeting for potentially common names to avoid false wakes.
    const greeting = ['hey','hay','hi','hello','okay','ok','yo','aye'];
    const offset = greeting.includes(words[0]) ? 1 : 0;
    let candidate = words[offset];
    let nameLength = 1;
    // Safari occasionally splits the spoken name 'Or-en' into two words.
    if (['or','aur','ore','ohr'].includes(candidate) && ['en','in','an','un'].includes(words[offset+1])) { candidate = 'oren'; nameLength = 2; }
    // Speech recognition sometimes fuses the greeting and name into one token.
    if (!offset && /^(?:heyauren|heyoren|heyaaron|heylauren|heyauron|heyorin)$/.test(candidate)) {
      return { command: words.slice(1).join(' ') };
    }
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
    const prefix = /^(hey|hay|hi|hello|okay|ok|yo|aye)\b/i.test(words[0] || '') ? 'Hey ' : '';
    return prefix + 'Auren' + (detected.command ? ' ' + detected.command : '');
  }
  const report = text => onStatus?.(text);
  const available = () => ({ listen: !!Recognition, speak: !!(synth && window.SpeechSynthesisUtterance) });
  const cancelTimers = () => { clearTimeout(restartTimer); clearTimeout(idleTimer); clearPhrase(); };
  const abort = () => { const old = recognition; recognition = null; active = false; engineRunning = false; if (old) try { old.abort(); } catch {} };
  function looksLikeUser(text) {
    const normalized = String(text || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const output = spokenText.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!normalized) return false;
    if (detectWake(text)) return true;
    if (normalized.split(' ').length < 3 || normalized.length < 12) return false;
    // Avoid stopping when Safari hears AUREN's own answer through speakers.
    return !output.includes(normalized) && !normalized.includes(output.slice(0, 40));
  }
  function interruptSpeech() {
    if (!speaking || !interruptionsEnabled) return;
    interrupted = true;
    currentUtterance = null;
    speaking = false; spokenText = '';
    if (synth) synth.cancel();
    report('Interrupted — listening to you…');
  }
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
      // Never go to sleep in the middle of a response or spoken answer.
      if (speaking || responding) { scheduleIdle(); return; }
      conversation = false;
      desiredMode = 'wake';
      onInterim?.('');
      report('Asleep — say “Hey Auren” or tap the orb.');
      if (!active) listenSoon(120);
    }, SILENCE_MS);
    else if (conversation) idleTimer = setTimeout(() => {
      // Conversation sleeps, but an already authorized active page stays in wake mode.
      conversation = false;
      wakeMode = true;
      desiredMode = 'wake';
      report('Asleep — waiting for “Hey Auren”');
      if (!active) listenSoon(250);
    }, SILENCE_MS);
  }
  function listenSoon(delay = 200) {
    clearTimeout(restartTimer);
    if (desiredMode === 'off' || (!wakeMode && !conversation) || (speaking && (!conversation || !interruptionsEnabled)) || responding || !permittedStart || errorStop || active || !Recognition) return;
    if (!pageVisible()) return;
    // Avoid the repeated start/stop permission loop that can occur in iOS Safari.
    const rest = mobileWebKit ? Math.max(0, 650 - (Date.now() - lastStart)) : 0;
    restartTimer = setTimeout(startEngine, Math.max(delay, rest));
  }
  function processPhrase(transcript) {
    if (responding || !transcript) return;
      if (speaking) {
        if (!interruptionsEnabled) return;
        // Safari may hear its own speakers. Only interrupt for a clear, distinct
        // utterance; a wake phrase always counts. Others need 3+ words and
        // must not be a fragment of what AUREN is currently saying.
        const cleaned = transcript.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
        const output = spokenText.toLowerCase().replace(/[^a-z0-9 ]/g, '');
        const wake = detectWake(transcript);
        if (!wake && (cleaned.split(/\s+/).length < 3 || output.includes(cleaned))) return;
        interruptSpeech();
        onInterim?.('');
        // Continue below through the exact same transcript pipeline as orb mode.
      }
      const detected = detectWake(transcript);
      const visibleTranscript = detected ? normalizeWakeDisplay(transcript) : transcript;
      if (wakeMode && !conversation && !detected) { onInterim?.(''); return; }
      clearTimeout(idleTimer);
      responding = true;
      onInterim?.('');
      if (detected) {
        conversation = true;
        if (!detected.command) {
          responding = false;
          // The recognizer finalized a standalone wake phrase after a pause.
          // Acknowledge briefly, then resume listening for the actual request.
          // A wake phrase with a command goes straight to deliver() instead.
          onHeard?.('Hey Auren');
          if (enabled && available().speak) {
            speak('Yes?');
          } else {
            report('Listening — go ahead…');
          }
          scheduleIdle();
          return;
        }
        onHeard?.(visibleTranscript);
        deliver(detected.command);
      } else if (conversation) {
        onHeard?.(visibleTranscript);
        deliver(transcript);
      } else responding = false;
  }
  function startEngine() {
    if (desiredMode === 'off' || active || (speaking && (!conversation || !interruptionsEnabled)) || responding || errorStop || (!conversation && !wakeMode) || !permittedStart) return;
    if (!pageVisible()) return;
    const id = ++token;
    lastStart = Date.now();
    const r = new Recognition(); recognition = r;
    r.lang = 'en-GB';
    // iOS speech services tend to work more consistently with individual utterances.
    r.continuous = !mobileWebKit;
    r.interimResults = true;
    r.maxAlternatives = mobileWebKit ? 3 : 5;
    r.onstart = () => { if (id === token) { engineRunning = true; restartFailures = 0; report(speaking ? 'Listening for an interruption…' : (conversation ? 'Listening…' : 'Say “Hey Auren” to speak')); } };
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
        if (speaking && interruptionsEnabled && looksLikeUser(preview)) {
          const comparable = preview.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim();
          if (comparable.startsWith(interruptionCandidate) || interruptionCandidate.startsWith(comparable)) interruptionSamples++;
          else interruptionSamples = 1;
          interruptionCandidate = comparable;
          if (interruptionSamples >= 2 || detectWake(preview)) interruptSpeech();
        }
        if (phraseParts.length) schedulePhrase();
        if (!speaking && (!wakeMode || conversation || detectWake(preview))) onInterim?.(normalizeWakeDisplay([...phraseParts, preview].join(' ')));
      }
      if (responding) return;
      // Final means 'this recognizer segment ended', not 'the speaker is done'.
      // Keep gathering words until a short pause, including on iPhone.
      if (finalResults.length) {
        for (let i = 0; i < finalResults.length; i++) {
          const item = finalResults[i];
          const finalText = item[0]?.transcript?.trim();
          if (finalText) queuePhrase(finalText);
        }
      }
    };
    r.onerror = e => {
      if (id !== token) return;
      if (['not-allowed','service-not-allowed','audio-capture'].includes(e.error)) {
        errorStop = true; wakeMode = false; conversation = false; desiredMode = 'off'; permittedStart = false;
        report('Microphone unavailable (' + e.error + '). Enable access and tap the orb again.');
      } else if (e.error === 'no-speech') {
        // Silence is not a microphone failure; continue waiting for wake phrase.
        if (mobileWebKit && conversation) scheduleIdle();
      } else if (e.error === 'network') {
        restartFailures = Math.min(restartFailures + 1, 5);
        report('Speech recognition needs a connection. You can retry by tapping the orb.');
      } else if (e.error !== 'aborted') {
        restartFailures = Math.min(restartFailures + 1, 5);
        report('Voice recognition issue: ' + e.error + '. Tap the orb if listening stops.');
      }
    };
    r.onend = () => {
      if (id !== token) return;
      recognition = null; active = false; engineRunning = false;
      if (!responding && !errorStop) {
        // Keep the final speech fragment pending while recognition restarts.
        // Back off failed sessions; do not hammer microphone permissions on iOS.
        const delay = mobileWebKit ? Math.min(2000, 500 + restartFailures * 300) : 230;
        listenSoon(delay);
      }
    };
    try { r.start(); active = true; report(conversation ? 'Listening…' : 'Say “Hey Auren” to speak'); }
    catch (err) {
      active = false; engineRunning = false; recognition = null;
      restartFailures = Math.min(restartFailures + 1, 5);
      report('Microphone could not start. Check Safari microphone access, then tap the orb again.');
      // A denied synchronous start should be retried by a tap, not an endless loop.
      errorStop = true;
    }
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
      // The AI often starts speech before this promise settles. Reactivate the
      // recognizer *after* responding becomes false, including during speech.
      if (speaking && interruptionsEnabled && conversation) listenSoon(90);
      else if (!speaking) listenSoon(180);
    }
  }
  function stopSpeaking() {
    if (synth) synth.cancel();
    currentUtterance = null;
    speaking = false; spokenText = '';
    if (!responding) listenSoon(120);
  }
  // iOS does not grant an independent "always allow audio" permission. Speech
  // synthesis may need its audio session initialized from a direct user gesture.
  function primeAudio() {
    if (!synth || !available().speak) return false;
    enabled = true;
    try {
      synth.resume();
      if (!audioPrimed && mobileWebKit && !speaking) {
        const warmup = new SpeechSynthesisUtterance(' ');
        warmup.volume = 0;
        warmup.lang = 'en-GB';
        synth.speak(warmup);
        audioPrimed = true;
      }
      return true;
    } catch (error) { report('iPhone audio is unavailable. Try tapping the orb again.'); return false; }
  }
  function speak(text) {
    if (!enabled || !available().speak || !text) return;
    try { synth.resume(); } catch {}
    // A fresh answer replaces prior speech; stop timers/recognition only once.
    // Keep recognition running during speech where Safari permits, so the user
    // can interrupt. Spoken-voice echo is filtered in the recognition handler.
    if (!conversation || !interruptionsEnabled) abort();
    if (synth) synth.cancel();
    clearPhrase(); speaking = true; interrupted = false; spokenText = text;
    interruptionCandidate = ''; interruptionSamples = 0;
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
    u.onend = () => { if (currentUtterance !== u) return; spokenText = ''; onSpoken?.(text, text); if (currentUtterance === u) currentUtterance = null; speaking = false; report(wakeMode ? 'Listening — ask a follow-up, or say “Hey Auren”' : (conversation ? 'Listening for your next question…' : 'Tap the orb to speak')); scheduleIdle(); if (!responding) listenSoon(160); };
    u.onerror = () => { if (currentUtterance !== u) return; spokenText = ''; if (currentUtterance === u) currentUtterance = null; speaking = false; report('Voice output stopped; text remains available.'); if (!responding) listenSoon(420); };
    try { synth.speak(u); report('AUREN speaking…'); if (interruptionsEnabled && conversation && !active && !responding) listenSoon(150); }
    catch { currentUtterance = null; speaking = false; report('Speech output unavailable.'); if (!responding) listenSoon(); }
  }
  function startListening() {
    if (!Recognition) { report('This browser cannot transcribe speech directly. On iPhone, use the keyboard microphone in Text chat.'); return false; }
    if (conversation && !wakeMode) { stopListening(); return false; }
    clearPhrase(); errorStop = false; permittedStart = true; wakeMode = true; conversation = true; desiredMode = 'conversation';
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
    if (!Recognition) { report('Wake phrase unavailable here. On iPhone, use the keyboard microphone in Text chat.'); return false; }
    // This must be called by a user interaction to receive microphone permission.
    clearPhrase(); errorStop = false; permittedStart = true; wakeMode = true; conversation = false; desiredMode = 'wake';
    cancelTimers(); if (speaking) stopSpeaking();
    startEngine(); // Safari requires this within the user's activation.
    if (active) report('Listening for “Hey Auren” while this page is active.');
    return true;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearPhrase(); clearTimeout(restartTimer); ++token; abort(); report('Voice paused while AUREN is in the background.'); }
    else if (permittedStart && (wakeMode || conversation) && !errorStop) {
      // Foreground resume is best effort; if Safari requires another gesture, tap orb.
      listenSoon(mobileWebKit ? 650 : 350);
    }
  });
  return {
    available, speak, primeAudio, stopSpeaking, startListening, stopListening, setWakeMode,
    getVoices() { return synth?.getVoices?.() || []; },
    setVoicePreference(uri) { preferredVoiceURI = String(uri || ""); fixedVoice = null; },
    setVoiceStyle({ rate, pitch } = {}) {
      if (Number.isFinite(Number(rate))) voiceRate = Math.max(0.7, Math.min(1.25, Number(rate)));
      if (Number.isFinite(Number(pitch))) voicePitch = Math.max(0.7, Math.min(1.3, Number(pitch)));
    },
    get listening() { return desiredMode !== 'off'; },
    get speaking() { return speaking; },
    get wakeMode() { return wakeMode; },
    get awake() { return conversation; },
    get enabled() { return enabled; },
    get interruptionsEnabled() { return interruptionsEnabled; },
    get microphoneActive() { return engineRunning; },
    setInterruptionsEnabled(value) {
      interruptionsEnabled = !!value;
      // Switching OFF immediately halts microphone recognition during playback.
      // It resumes only after AUREN finishes talking.
      if (!interruptionsEnabled && speaking) { ++token; abort(); clearTimeout(restartTimer); }
      interruptionCandidate = ''; interruptionSamples = 0;
      // Switching ON is best-effort; never auto-request microphone permissions.
      if (interruptionsEnabled && speaking && permittedStart && conversation && !responding) listenSoon(90);
      return interruptionsEnabled;
    },
    setEnabled(v) { enabled = !!v; if (!enabled) stopSpeaking(); }
  };
}
