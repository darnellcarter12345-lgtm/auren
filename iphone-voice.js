// AUREN v3.25 — one-button iPhone conversation control and reliable finish.
// Replace iphone-voice.js only. app.js / desktop voice remain unchanged.
export function createIPhoneRecorder({ endpoint, onStatus, onText }) {
  let stream = null, recorder = null, context = null, source = null, analyser = null;
  let chunks = [], monitor = null, deadline = null, stopGuard = null;
  let phase = 'idle', serial = 0, began = 0, speechStarted = 0, lastVoice = 0;
  let baseline = 0.006, positiveFrames = 0;
  let session = false, sleepTimer = null, nextTurnTimer = null, stopRequested = false;
  let deliverySucceeded = false, silentTurns = 0, micReadyAt = 0, speechFrames = 0;
  let transcriptionAbort = null;
  const SESSION_IDLE_MS = 30000;
  const QUIET_TURN_MS = 13500;
  const MAX_QUIET_TURNS = 2;
  const isVisible = () => !document.hidden;
  const sleep = () => { endConversation('Conversation asleep. Tap Speak to AUREN to start again.'); };
  function armSleep() {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      // Don't sleep in the middle of a spoken reply.
      if (phase !== 'idle' || window.speechSynthesis?.speaking || window.speechSynthesis?.pending) { armSleep(); return; }
      sleep('Conversation asleep. Tap to start again.');
    }, SESSION_IDLE_MS);
  }
  function queueNextTurn() {
    clearTimeout(nextTurnTimer); clearTimeout(sleepTimer);
    if (!session || !isVisible()) return;
    const started = Date.now(); let heardSpeech = false, settledAt = 0;
    // Safari releases its audio output asynchronously. Never record over AUREN's voice.
    const step = () => {
      if (!session || !isVisible() || phase !== 'idle') return;
      const speaking = !!(window.speechSynthesis?.speaking || window.speechSynthesis?.pending ||
        /AUREN speaking/i.test(document.getElementById('voiceStatus')?.textContent || ''));
      if (speaking) { heardSpeech = true; settledAt = 0; }
      else if (heardSpeech && !settledAt) settledAt = Date.now();
      // Allow speech to begin; this also handles silent replies (speech disabled).
      if ((heardSpeech && settledAt && Date.now() - settledAt > 650) ||
          (!heardSpeech && Date.now() - started > 6200)) {
        status.textContent = 'Conversation open — listening for your next question…';
        void start(true); return;
      }
      if (Date.now() - started > 75000) { armSleep(); return; }
      nextTurnTimer = setTimeout(step, 220);
    };
    nextTurnTimer = setTimeout(step, 220);
  }
  const MAX_MS = 45000, MAX_BYTES = 2 * 1024 * 1024;
  const report = (message, state = 'idle') => {
    onStatus?.(message, state);
    updateButton(state);
  };
  // The button is inserted only when app.js constructs this iPhone recorder.
  // Mac never constructs it, and its existing orb and microphone code are untouched.
  const button = document.createElement('button');
  button.id = 'aurenIPhoneTalk';
  button.type = 'button';
  button.textContent = '🎙 Speak to AUREN';
  button.setAttribute('aria-label', 'Speak to AUREN');
  button.setAttribute('aria-pressed', 'false');
  button.style.cssText = 'display:block;margin:16px auto 8px;min-height:54px;min-width:220px;max-width:90%;padding:14px 22px;border-radius:999px;border:1px solid #d3ae6b;background:#b99457;color:#161719;font:600 16px system-ui,-apple-system,sans-serif;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent';
  const status = document.createElement('p');
  status.id = 'aurenIPhoneMicHint';
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Tap once to talk. Pause to send, or tap again to finish.';
  status.style.cssText = 'font-size:12px;opacity:.7;text-align:center;margin:4px auto 12px;max-width:300px';
  const hintTarget = document.getElementById('wakeHint');
  if (hintTarget?.parentElement) hintTarget.insertAdjacentElement('afterend', button);
  else document.getElementById('orbControl')?.insertAdjacentElement('afterend', button);
  button.insertAdjacentElement('afterend', status);
  // Only one voice button on iPhone. A tap starts an open conversation;
  // while open, the same button *ends the entire session*, not just a turn.
  button.addEventListener('click', () => {
    if (session) { endConversation(); return; }
    if (phase !== 'idle') { endConversation(); return; }
    session = true;
    clearTimeout(sleepTimer); clearTimeout(nextTurnTimer);
    updateButton('starting');
    void start(false);
  });
  function endConversation(message = 'Conversation ended. Microphone off.') {
    session = false;
    ++serial; // Invalidate pending permission callbacks and recorder events.
    clearTimeout(sleepTimer); clearTimeout(nextTurnTimer);
    clearTimeout(stopGuard); stopGuard = null;
    try { transcriptionAbort?.abort(); } catch {}
    transcriptionAbort = null;
    const previous = recorder;
    reset(); // Stops all microphone tracks, monitoring, and timers.
    try { if (previous?.state === 'recording') previous.stop(); } catch {}
    // When the user ends a conversation, also silence any playing browser TTS.
    try { window.speechSynthesis?.cancel(); } catch {}
    report(message, 'idle');
  }
  function updateButton(state) {
    const active = session;
    button.textContent = active ? '■ Finish Talking' : '🎙 Speak to AUREN';
    button.disabled = false; // Always allow ending, even during network processing.
    button.style.opacity = '1';
    button.style.background = active ? '#302820' : '#b99457';
    button.style.color = active ? '#f4d6a0' : '#161719';
    button.setAttribute('aria-pressed', String(active));
    status.textContent = !active ? 'Tap to start a conversation.' :
      phase === 'recording' ? 'Listening… Pause to send. Tap Finish Talking to end the session.' :
      phase === 'processing' || phase === 'starting' || phase === 'stopping' ? 'One moment… Finish Talking is always available.' :
      'Conversation open. AUREN will listen again after replying.';
  }
  function discardCurrentRecording() {
    ++serial;
    const oldRecorder = recorder;
    reset();
    try { if (oldRecorder?.state === 'recording') oldRecorder.stop(); } catch {}
    report('Conversation ended. Microphone off.', 'idle');
  }
  function stopMonitoring() {
    clearInterval(monitor); monitor = null;
    clearTimeout(deadline); deadline = null;
    try { source?.disconnect(); } catch {}
    source = null; analyser = null;
    if (context) { try { void context.close(); } catch {} }
    context = null;
  }
  function stopTracks() {
    if (stream) for (const t of stream.getTracks()) { try { t.onended = null; t.stop(); } catch {} }
    stream = null;
  }
  function reset() {
    clearTimeout(stopGuard); stopGuard = null;
    stopMonitoring(); stopTracks(); recorder = null; chunks = [];
    phase = 'idle'; updateButton('idle');
  }
  function preferredMime() {
    for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
      if (window.MediaRecorder?.isTypeSupported?.(m)) return m;
    }
    return '';
  }
  function watchSpeech(media) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // User can always finish by tapping.
    try {
      context = new AC(); source = context.createMediaStreamSource(media);
      analyser = context.createAnalyser(); analyser.fftSize = 1024;
      source.connect(analyser);
      const buffer = new Float32Array(analyser.fftSize);
      monitor = setInterval(() => {
        if (phase !== 'recording' || document.hidden) return;
        try { analyser.getFloatTimeDomainData(buffer); } catch { return; }
        let square = 0;
        for (let i = 0; i < buffer.length; i++) square += buffer[i] * buffer[i];
        const rms = Math.sqrt(square / buffer.length), now = Date.now();
        if (now - began < 800) baseline = baseline * .9 + Math.min(rms, .04) * .1;
        // A lower adaptive threshold helps quiet iPhone voices. Keep sustained-frame gating to avoid noise triggers.
        const threshold = Math.max(.007, Math.min(.030, baseline * 2.2));
        if (rms > threshold) {
          positiveFrames++;
          if (positiveFrames >= 3) { if (!speechStarted) speechStarted = now; lastVoice = now; speechFrames++; }
        } else positiveFrames = 0;
        if (speechStarted && now - began > 2000 && now - speechStarted > 950 && now - lastVoice > 3000) void stop();
        // Do not submit silence to transcription as an empty request.
        if (!speechStarted && now - micReadyAt > QUIET_TURN_MS) {
          if (session && ++silentTurns < MAX_QUIET_TURNS) {
            // Keep the same recorder alive for one more listening window.
            micReadyAt = now;
            report('Still listening. You can speak whenever you are ready.', 'listening');
          } else {
            session = false;
            discardCurrentRecording();
            report('Conversation asleep after silence. Tap Speak to AUREN again.', 'idle');
          }
        }
        // Don't drop messages just because microphone amplitude is quiet.
        // If detection isn't confident, manual tap or maximum duration remains available.
      }, 110);
      context.resume?.().catch?.(() => {});
    } catch { stopMonitoring(); }
  }
  async function deliver(blob) {
    const base = String(endpoint?.() || '').trim().replace(/\/$/, '');
    if (!base) { report('Connect the Cloudflare AI URL in Settings.', 'error'); return; }
    if (!blob.size || blob.size > MAX_BYTES) { report('Recording empty or too long. Please try again.', 'error'); return; }
    report('Transcribing your voice…', 'processing');
    const form = new FormData();
    form.append('audio', blob, blob.type.includes('mp4') ? 'voice.m4a' : 'voice.webm');
    const controller = new AbortController();
    transcriptionAbort = controller;
    const timer = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch(base + '/transcribe', { method: 'POST', body: form, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(data.error || `Transcription error (${response.status})`);
      const text = String(data.text || '').trim();
      if (!text) { report('I could not hear words clearly. Tap to retry.', 'error'); return; }
      report('Heard: ' + text.slice(0, 100), 'processing');
      await onText(text);
      deliverySucceeded = true; silentTurns = 0;
      report('Reply received.', 'idle');
    } catch (err) {
      report(err.name === 'AbortError' ? 'Voice request timed out. Tap to retry.' : 'Voice request failed: ' + (err.message || 'Please retry.'), 'error');
    } finally { clearTimeout(timer); if (transcriptionAbort === controller) transcriptionAbort = null; }
  }
  async function start(automatic = false) {
    if (phase !== 'idle' || !session) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { report('Microphone unavailable. Open AUREN in iPhone Safari over HTTPS.', 'error'); return; }
    phase = 'starting'; const token = ++serial;
    if (!automatic) silentTurns = 0;
    clearTimeout(sleepTimer); deliverySucceeded = false;
    report('Connecting microphone…', 'processing');
    try {
      // Permission request is the first awaited action, directly from the tap.
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      if (token !== serial || document.hidden) { media.getTracks().forEach(t => t.stop()); reset(); return; }
      stream = media;
      for (const track of media.getAudioTracks()) track.onended = () => {
        if (token !== serial || phase === 'stopping') return;
        ++serial; reset(); report('Microphone disconnected. Tap to reconnect.', 'error');
      };
      const mime = preferredMime();
      const r = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      recorder = r; chunks = []; speechStarted = 0; lastVoice = 0; positiveFrames = 0; baseline = .006;
      r.ondataavailable = e => { if (token === serial && e.data?.size) chunks.push(e.data); };
      r.onerror = () => { if (token !== serial) return; ++serial; reset(); report('Recording failed. Tap to retry.', 'error'); };
      r.onstop = async () => {
        if (token !== serial) return;
        clearTimeout(stopGuard); stopGuard = null;
        const blob = new Blob(chunks, { type: r.mimeType || mime || 'audio/mp4' });
        stopMonitoring(); stopTracks(); recorder = null; chunks = [];
        phase = 'processing'; updateButton('processing');
        try { await deliver(blob); } finally {
          if (token === serial) {
            phase = 'idle'; updateButton('idle');
            if (session && deliverySucceeded) queueNextTurn();
            else if (session) armSleep();
          }
        }
      };
      r.start(250); began = Date.now(); micReadyAt = began; phase = 'recording';
      report('I’m listening… Speak naturally.', 'listening');
      watchSpeech(media);
      deadline = setTimeout(() => { if (phase === 'recording') void stop(); }, MAX_MS);
    } catch (err) {
      if (token !== serial) return;
      reset();
      if (automatic) {
        // Some Safari releases require a fresh gesture for permission/audio sessions.
        session = false; updateButton('idle');
        report('Safari needs one more tap to resume the microphone.', 'error');
      } else report(err.name === 'NotAllowedError' ? 'Microphone denied. Allow it in Safari website settings.' : 'Microphone problem: ' + err.message, 'error');
    }
  }
  async function stop() {
    if (phase !== 'recording' || !recorder) return;
    const token = serial, r = recorder;
    phase = 'stopping'; report('Finishing your message…', 'processing');
    stopMonitoring();
    try {
      if (r.state === 'recording') {
        try { r.requestData(); } catch {}
        r.stop();
        stopGuard = setTimeout(() => {
          if (token !== serial || (phase !== 'stopping' && phase !== 'processing')) return;
          if (phase === 'processing') return; // Don't abort an active network call.
          ++serial; reset(); report('Recorder reset. Tap to speak again.', 'error');
        }, 6500);
      } else { ++serial; reset(); report('Recorder reset. Tap to try again.', 'error'); }
    } catch (err) { ++serial; reset(); report('Could not stop recording: ' + err.message, 'error'); }
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !['starting','recording','stopping'].includes(phase)) return;
    ++serial; session = false; clearTimeout(sleepTimer); clearTimeout(nextTurnTimer);
    const old = recorder; reset();
    try { if (old?.state === 'recording') old.stop(); } catch {}
    report('Microphone off while Safari is in the background.', 'idle');
  });
  return { start: () => { if (!session) session = true; return start(false); }, stop, finish: endConversation, get recording() { return phase === 'recording'; }, get busy() { return phase === 'starting' || phase === 'stopping' || phase === 'processing'; } };
}
