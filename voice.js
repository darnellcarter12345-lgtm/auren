
// AUREN v2 — Voice recognition and speech
// Browser-based speech recognition requires microphone permission.
// Wake-word listening only works while the browser permits it.

export function createVoice({
  onTranscript,
  onStatus,
  onInterim,
  onHeard,
  onSpoken
}) {
  const Recognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  const synth = window.speechSynthesis || null;

  let recognition = null;
  let active = false;
  let engineRunning = false;
  let wakeMode = false;
  let conversation = false;
  let speaking = false;
  let responding = false;
  let enabled = false;
  let permittedStart = false;

  let token = 0;
  let restartTimer = null;
  let idleTimer = null;
  let errorStop = false;
  let desiredMode = 'off';
  let currentUtterance = null;
  let fixedVoice = null;
  let spokenText = '';
  let interrupted = false;

  let interruptionsEnabled = false;
  let interruptionCandidate = '';
  let interruptionSamples = 0;

  let preferredVoiceURI = '';
  let voiceRate = 0.96;
  let voicePitch = 0.95;

  const SILENCE_MS = 45000;

  const wakeNames = new Set([
    'auren',
    'aurin',
    'auron',
    'oren',
    'orin',
    'orren',
    'aaron',
    'aron',
    'erin',
    'lauren',
    'loren',
    'orion'
  ]);

  function wordsOf(text) {
    return text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function detectWake(text) {
    const words = wordsOf(text);
    if (!words.length) return null;

    const greeting = ['hey', 'hi', 'hello', 'okay', 'ok', 'yo'];
    const offset = greeting.includes(words[0]) ? 1 : 0;

    let candidate = words[offset];
    let nameLength = 1;

    if (
      ['or', 'aur', 'ore'].includes(candidate) &&
      ['en', 'in', 'an'].includes(words[offset + 1])
    ) {
      candidate = 'oren';
      nameLength = 2;
    }

    if (!wakeNames.has(candidate)) return null;

    if (
      !offset &&
      candidate !== 'auren' &&
      candidate !== 'aurin' &&
      candidate !== 'auron'
    ) {
      return null;
    }

    if (
      !offset &&
      words.length > nameLength &&
      ![
        'can',
        'could',
        'please',
        'tell',
        'what',
        'remind',
        'remember',
        'help',
        'how',
        'do'
      ].includes(words[nameLength])
    ) {
      return null;
    }

    return {
      command: words.slice(offset + nameLength).join(' ')
    };
  }

  function normalizeWakeDisplay(text) {
    const words = String(text || '').trim().split(/\s+/);
    const detected = detectWake(text);

    if (!detected) return String(text || '').trim();

    const prefix = /^(hey|hi|hello|okay|ok|yo)\b/i.test(
      words[0] || ''
    ) ? 'Hey ' : '';

    return prefix + 'Auren' +
      (detected.command ? ' ' + detected.command : '');
  }

  const report = text => onStatus?.(text);

  const available = () => ({
    listen: !!Recognition,
    speak: !!(synth && window.SpeechSynthesisUtterance)
  });

  const cancelTimers = () => {
    clearTimeout(restartTimer);
    clearTimeout(idleTimer);
  };

  const abort = () => {
    const old = recognition;
    recognition = null;
    active = false;
    engineRunning = false;

    if (old) {
      try {
        old.abort();
      } catch {}
    }
  };

  function looksLikeUser(text) {
    const normalized = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const output = spokenText
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!normalized) return false;
    if (detectWake(text)) return true;

    if (
      normalized.split(' ').length < 3 ||
      normalized.length < 12
    ) {
      return false;
    }

    return !output.includes(normalized) &&
      !normalized.includes(output.slice(0, 40));
  }

  function interruptSpeech() {
    if (!speaking || !interruptionsEnabled) return;

    interrupted = true;
    currentUtterance = null;
    speaking = false;
    spokenText = '';

    if (synth) synth.cancel();

    report('Interrupted — listening to you…');
  }

  const voicePick = () => {
    if (fixedVoice) return fixedVoice;

    const voices = synth?.getVoices?.() || [];

    if (preferredVoiceURI) {
      const explicit = voices.find(
        v => v.voiceURI === preferredVoiceURI
      );
      if (explicit) return explicit;
    }

    const isEnglish = v => /^en(?:-|$)/i.test(v.lang);

    const novelty =
      /bad news|good news|bells|bubbles|whisper|zarvox|trinoids|cellos|boing|organ|bahh|albert|fred|hysterical|jester|wobble|robot|novelty/i;

    const candidates = voices.filter(
      v => isEnglish(v) && !novelty.test(v.name)
    );

    const score = v => {
      const name = v.name || '';

      let n = /^en-GB$/i.test(v.lang)
        ? 100
        : /^en-(IE|AU|NZ)$/i.test(v.lang)
          ? 30
          : 0;

      if (v.localService) n += 8;
      if (/premium|enhanced|natural|neural/i.test(name)) n += 35;
      if (/daniel|oliver|arthur|george|jamie|ryan|alabaster/i.test(name)) {
        n += 25;
      }
      if (/siri/i.test(name)) n += 10;
      if (/female|child/i.test(name)) n -= 15;

      return n;
    };

    const chosen =
      candidates.sort((a, b) => score(b) - score(a))[0] || null;

    if (chosen) fixedVoice = chosen;
    return fixedVoice;
  };

  function scheduleIdle() {
    clearTimeout(idleTimer);

    if (conversation && wakeMode) {
      idleTimer = setTimeout(() => {
        conversation = false;
        report(
          'Conversation paused after silence. Say “Hey Auren” to resume.'
        );
      }, SILENCE_MS);
    } else if (conversation) {
      idleTimer = setTimeout(() => {
        stopListening();
        report(
          'Conversation ended after silence. Tap the orb to speak again.'
        );
      }, SILENCE_MS);
    }
  }

  function listenSoon(delay = 200) {
    clearTimeout(restartTimer);

    if (
      desiredMode === 'off' ||
      (!wakeMode && !conversation) ||
      (speaking && (!conversation || !interruptionsEnabled)) ||
      responding ||
      !permittedStart ||
      errorStop ||
      active ||
      !Recognition
    ) {
      return;
    }

    restartTimer = setTimeout(startEngine, delay);
  }

  function startEngine() {
    if (
      desiredMode === 'off' ||
      active ||
      (speaking && (!conversation || !interruptionsEnabled)) ||
      responding ||
      errorStop ||
      (!conversation && !wakeMode) ||
      !permittedStart
    ) {
      return;
    }

    const id = ++token;
    const r = new Recognition();

    recognition = r;
    r.lang = 'en-GB';
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 5;

    r.onstart = () => {
      if (id !== token) return;

      engineRunning = true;

      report(
        speaking
          ? 'Listening for an interruption…'
          : conversation
            ? 'Listening…'
            : 'Say “Hey Auren” to speak'
      );
    };

    r.onresult = event => {
      if (id !== token) return;

      const finalResults = [];
      const interim = [];

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];

        if (result.isFinal) {
          finalResults.push(result);
        } else if (result[0]?.transcript) {
          interim.push(result[0].transcript.trim());
        }
      }

      if (interim.length) {
        const preview = interim.join(' ').trim();

        if (
          speaking &&
          interruptionsEnabled &&
          looksLikeUser(preview)
        ) {
          const comparable = preview
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, ' ')
            .trim();

          if (
            comparable.startsWith(interruptionCandidate) ||
            interruptionCandidate.startsWith(comparable)
          ) {
            interruptionSamples++;
          } else {
            interruptionSamples = 1;
          }

          interruptionCandidate = comparable;

          if (
            interruptionSamples >= 2 ||
            detectWake(preview)
          ) {
            interruptSpeech();
          }
        }

        if (
          !speaking &&
          (!wakeMode || conversation || detectWake(preview))
        ) {
          onInterim?.(normalizeWakeDisplay(preview));
        }
      }

      if (!finalResults.length || responding) return;

      const alternatives = finalResults.flatMap(
        item => Array.from(item)
          .map(a => a.transcript?.trim())
          .filter(Boolean)
      );

      const transcript = alternatives[0] || '';
      if (!transcript) return;

      if (speaking) {
        if (!interruptionsEnabled) return;

        const cleaned = transcript
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, '')
          .trim();

        const output = spokenText
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, '');

        const wake = alternatives.map(detectWake).find(Boolean);

        if (
          !wake &&
          (
            cleaned.split(/\s+/).length < 3 ||
            output.includes(cleaned)
          )
        ) {
          return;
        }

        interruptSpeech();
        onInterim?.('');
      }

      const detected = alternatives.map(detectWake).find(Boolean);

      const visibleTranscript = detected
        ? normalizeWakeDisplay(
            alternatives.find(a => detectWake(a)) || transcript
          )
        : transcript;

      if (wakeMode && !conversation && !detected) {
        onInterim?.('');
        return;
      }

      clearTimeout(idleTimer);
      responding = true;
      onInterim?.('');

      if (detected) {
        conversation = true;

        if (!detected.command) {
          responding = false;
          report('Listening — go ahead…');
          scheduleIdle();
          return;
        }

        onHeard?.(visibleTranscript);
        deliver(detected.command);
      } else if (conversation) {
        onHeard?.(visibleTranscript);
        deliver(transcript);
      } else {
        responding = false;
      }
    };

    r.onerror = e => {
      if (id !== token) return;

      if (
        ['not-allowed', 'service-not-allowed', 'audio-capture']
          .includes(e.error)
      ) {
        errorStop = true;
        wakeMode = false;
        conversation = false;
        desiredMode = 'off';
        permittedStart = false;

        report(
          'Microphone unavailable (' + e.error +
          '). Enable access and tap the orb again.'
        );
      } else if (
        e.error !== 'aborted' &&
        e.error !== 'no-speech'
      ) {
        report('Voice recognition issue: ' + e.error + '.');
      }
    };

    r.onend = () => {
      if (id !== token) return;

      recognition = null;
      active = false;
      engineRunning = false;

      if (!responding && !errorStop) {
        listenSoon(450);
      }
    };

    try {
      r.start();
      active = true;

      report(
        conversation
          ? 'Listening…'
          : 'Say “Hey Auren” to speak'
      );
    } catch {
      active = false;
      engineRunning = false;
      recognition = null;

      report(
        'Safari could not start microphone recognition. Tap the orb to retry.'
      );
    }
  }

  async function deliver(text) {
    try {
      report('Thinking…');
      await onTranscript?.(text);
    } catch (error) {
      console.error('AUREN request failed', error);

      report(
        'Request error: ' +
        (error?.message || 'Unknown issue') +
        '. You can try again.'
      );
    } finally {
      responding = false;
      scheduleIdle();

      if (
        speaking &&
        interruptionsEnabled &&
        conversation
      ) {
        listenSoon(150);
      } else if (!speaking) {
        listenSoon(400);
      }
    }
  }

  function stopSpeaking() {
    if (synth) synth.cancel();

    currentUtterance = null;
    speaking = false;
    spokenText = '';

    if (!responding) listenSoon(350);
  }

  function speak(text) {
    if (!enabled || !available().speak || !text) return;

    if (!conversation || !interruptionsEnabled) abort();
    if (synth) synth.cancel();

    speaking = true;
    interrupted = false;
    spokenText = text;

    interruptionCandidate = '';
    interruptionSamples = 0;

    const u = new SpeechSynthesisUtterance(text);
    currentUtterance = u;

    u.lang = 'en-GB';
    u.rate = voiceRate;
    u.pitch = voicePitch;

    const chosen = voicePick();

    if (chosen) {
      u.voice = chosen;
      u.lang = chosen.lang;
    }

    u.onstart = () => {
      if (currentUtterance !== u) return;

      onSpoken?.(text, text);
      report('AUREN speaking…');
    };

    u.onboundary = e => {
      if (currentUtterance !== u) return;

      if (Number.isInteger(e.charIndex) && e.charIndex >= 0) {
        const end = Math.min(
          text.length,
          e.charIndex + (e.charLength || 1)
        );

        onSpoken?.(text.slice(0, end), text);
      }
    };

    u.onend = () => {
      if (currentUtterance !== u) return;

      spokenText = '';
      onSpoken?.(text, text);

      if (currentUtterance === u) currentUtterance = null;

      speaking = false;

      report(
        wakeMode
          ? 'Listening — ask a follow-up, or say “Hey Auren”'
          : conversation
            ? 'Listening for your next question…'
            : 'Tap the orb to speak'
      );

      scheduleIdle();

      if (!responding) listenSoon(250);
    };

    u.onerror = () => {
      if (currentUtterance !== u) return;

      spokenText = '';

      if (currentUtterance === u) currentUtterance = null;

      speaking = false;
      report('Voice output stopped; text remains available.');

      if (!responding) listenSoon(420);
    };

    try {
      synth.speak(u);
      report('AUREN speaking…');

      if (
        interruptionsEnabled &&
        conversation &&
        !active &&
        !responding
      ) {
        listenSoon(150);
      }
    } catch {
      currentUtterance = null;
      speaking = false;
      report('Speech output unavailable.');

      if (!responding) listenSoon();
    }
  }

  function startListening() {
    if (!Recognition) {
      report('Speech recognition is unsupported here.');
      return false;
    }

    if (conversation && !wakeMode) {
      stopListening();
      return false;
    }

    errorStop = false;
    permittedStart = true;
    conversation = true;
    desiredMode = 'conversation';

    clearTimeout(idleTimer);

    if (speaking) stopSpeaking();

    scheduleIdle();
    startEngine();

    return true;
  }

  function stopListening() {
    wakeMode = false;
    conversation = false;
    responding = false;
    permittedStart = false;
    desiredMode = 'off';

    cancelTimers();
    ++token;
    abort();

    report('Microphone off. Tap the orb to speak.');
    return false;
  }

  function setWakeMode(value) {
    if (!value) {
      stopListening();
      return false;
    }

    if (!Recognition) {
      report('Wake phrase unavailable in this browser.');
      return false;
    }

    errorStop = false;
    permittedStart = true;
    wakeMode = true;
    conversation = false;
    desiredMode = 'wake';

    cancelTimers();

    if (speaking) stopSpeaking();

    startEngine();

    if (active) {
      report(
        'Listening for “Hey Auren” while this page is active.'
      );
    }

    return true;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(restartTimer);
      ++token;
      abort();

      report(
        'Voice paused while AUREN is in the background.'
      );
    } else if (
      permittedStart &&
      (wakeMode || conversation) &&
      !errorStop
    ) {
      listenSoon(350);
    }
  });

  return {
    available,
    speak,
    stopSpeaking,
    startListening,
    stopListening,
    setWakeMode,

    getVoices() {
      return synth?.getVoices?.() || [];
    },

    setVoicePreference(uri) {
      preferredVoiceURI = String(uri || '');
      fixedVoice = null;
    },

    setVoiceStyle({ rate, pitch } = {}) {
      if (Number.isFinite(Number(rate))) {
        voiceRate = Math.max(
          0.7,
          Math.min(1.25, Number(rate))
        );
      }

      if (Number.isFinite(Number(pitch))) {
        voicePitch = Math.max(
          0.7,
          Math.min(1.3, Number(pitch))
        );
      }
    },

    get listening() {
      return desiredMode !== 'off';
    },

    get speaking() {
      return speaking;
    },

    get wakeMode() {
      return wakeMode;
    },

    get enabled() {
      return enabled;
    },

    get interruptionsEnabled() {
      return interruptionsEnabled;
    },

    get microphoneActive() {
      return engineRunning;
    },

    setInterruptionsEnabled(value) {
      interruptionsEnabled = !!value;

      if (!interruptionsEnabled && speaking) {
        ++token;
        abort();
        clearTimeout(restartTimer);
      }

      interruptionCandidate = '';
      interruptionSamples = 0;

      if (
        interruptionsEnabled &&
        speaking &&
        permittedStart &&
        conversation &&
        !responding
      ) {
        listenSoon(250);
      }

      return interruptionsEnabled;
    },

    setEnabled(v) {
      enabled = !!v;
      if (!enabled) stopSpeaking();
    }
  };
}
