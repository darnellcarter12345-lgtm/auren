// AUREN v2.9.5 — native iPhone microphone capture + Cloudflare transcription.
// User tap -> getUserMedia -> MediaRecorder -> user tap -> POST /transcribe.
// No wake-word/background recording. Audio is not stored in localStorage.
export function createIPhoneRecorder({ endpoint, onStatus, onText }) {
  let stream = null, recorder = null, recording = false, busy = false;
  let chunks = [], timeout = null, startedAt = 0;
  const MAX_MS = 45000;
  const MAX_BYTES = 2 * 1024 * 1024;
  const report = (message, state='idle') => onStatus?.(message, state);
  function cleanup() {
    clearTimeout(timeout); timeout = null;
    if (stream) stream.getTracks().forEach(track => track.stop());
    stream = null; recorder = null; recording = false;
  }
  function mime() {
    for (const kind of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
      if (MediaRecorder.isTypeSupported(kind)) return kind;
    }
    return '';
  }
  async function upload(blob) {
    const url = endpoint();
    if (!url) {
      report('Connect your Cloudflare AI URL in Settings. The same Google account can sync this setting from your Mac.', 'error');
      return;
    }
    if (!blob.size || blob.size > MAX_BYTES) {
      report('Recording is empty or too large. Try a shorter message.', 'error'); return;
    }
    report('Transcribing your voice…', 'processing');
    const form = new FormData(); form.append('audio', blob, blob.type.includes('mp4') ? 'voice.m4a' : 'voice.webm');
    const controller = new AbortController();
    const wait = setTimeout(() => controller.abort(), 35000);
    try {
      const response = await fetch(url + '/transcribe', {method:'POST', body:form, signal:controller.signal});
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || `Transcription error (${response.status})`);
      const text = String(json.text || '').trim();
      if (!text) { report('No speech detected. Tap the orb and speak again.', 'error'); return; }
      report('Heard: ' + text.slice(0,100), 'processing');
      await onText(text);
      report('Voice message sent. Tap the orb to speak again.', 'idle');
    } catch(error) {
      report('Voice service: ' + (error.name === 'AbortError' ? 'Timed out.' : error.message), 'error');
    } finally { clearTimeout(wait); }
  }
  async function start() {
    if (busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      report('Recording is unavailable here. Open AUREN in Safari using HTTPS.', 'error'); return;
    }
    busy = true;
    report('Requesting microphone…', 'processing');
    try {
      // Call immediately from the tap, before awaiting unrelated operations.
      const source = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}});
      stream = source;
      chunks = [];
      const kind = mime();
      recorder = new MediaRecorder(source, kind ? {mimeType:kind} : undefined);
      recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
      recorder.onerror = () => { cleanup(); report('Recording failed. Try tapping the orb again.', 'error'); };
      recorder.onstop = async () => {
        const data = new Blob(chunks, {type:recorder?.mimeType || kind || 'audio/mp4'});
        chunks = []; cleanup(); busy = true;
        try { await upload(data); } finally { busy = false; }
      };
      recorder.start(250);
      recording = true;
      startedAt = Date.now();
      report('Recording… Tap the orb again to send.', 'listening');
      timeout = setTimeout(() => { if (recording) void stop(); }, MAX_MS);
    } catch(error) {
      cleanup(); report(error.name === 'NotAllowedError' ? 'Microphone denied. In Safari Website Settings, allow Microphone for AUREN.' : 'Microphone problem: '+error.message, 'error');
    } finally { busy = false; }
  }
  async function stop() {
    if (!recording || !recorder || busy) return;
    recording = false;
    report('Processing recording…', 'processing');
    try { recorder.stop(); }
    catch(error) { cleanup(); report('Could not finish recording: '+error.message, 'error'); }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && recording) { chunks=[]; cleanup(); report('Recording stopped when Safari went into the background.', 'idle'); }
  });
  return {start,stop,get recording(){return recording;},get busy(){return busy;}};
}
