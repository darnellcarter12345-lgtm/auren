// AUREN iPhone voice v3.20 — one-tap recording with local speech-end detection.
// Microphone opens only on tap and is closed before transcription or AI response.
export function createIPhoneRecorder({ endpoint, onStatus, onText }) {
  let stream=null, recorder=null, recording=false, busy=false;
  let chunks=[], timeout=null, audioContext=null, analyser=null, sourceNode=null, detectionTimer=null;
  let startedAt=0, hasSpeech=false, speechSince=0, lastSpeechAt=0, baseline=0.006, peak=0;
  let finishing=false, generation=0, stopWatchdog=null;
  const MAX_MS=45000, MAX_BYTES=2*1024*1024, NO_SPEECH_MS=15000, MIN_SPEECH_MS=650, SILENCE_MS=2300;
  const report=(message,state='idle')=>onStatus?.(message,state);
  function releaseAudio(){
    clearInterval(detectionTimer);detectionTimer=null;
    try{sourceNode?.disconnect();}catch{} sourceNode=null;analyser=null;
    if(audioContext){try{void audioContext.close();}catch{}}audioContext=null;
  }
  function cleanup(){
    clearTimeout(stopWatchdog);stopWatchdog=null;
    clearTimeout(timeout);timeout=null;releaseAudio();
    if(stream){for(const t of stream.getTracks())try{t.stop();}catch{}}
    stream=null;recorder=null;recording=false;
  }
  function mime(){
    for(const kind of ['audio/mp4','audio/webm;codecs=opus','audio/webm'])
      if(window.MediaRecorder?.isTypeSupported(kind))return kind;
    return '';
  }
  async function upload(blob){
    const url=endpoint();
    if(!url){report('Connect the Cloudflare AI URL in Settings.','error');return;}
    if(!blob.size||blob.size>MAX_BYTES){report('Recording is empty or too large. Try again.','error');return;}
    report('Transcribing your voice…','processing');
    const form=new FormData();form.append('audio',blob,blob.type.includes('mp4')?'voice.m4a':'voice.webm');
    const controller=new AbortController();const wait=setTimeout(()=>controller.abort(),35000);
    try{
      const response=await fetch(url.replace(/\/$/,'')+'/transcribe',{method:'POST',body:form,signal:controller.signal});
      const json=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(json.error||`Transcription error (${response.status})`);
      const text=String(json.text||'').trim();
      if(!text){report('No speech detected. Tap once and try again.','error');return;}
      report('Heard: '+text.slice(0,100),'processing');
      await onText(text);
      // The recorder is available again on the next turn; playback owns the speaking UI.
      report('Ready for your next question.','idle');
    }catch(error){report('Voice service: '+(error.name==='AbortError'?'Timed out.':error.message),'error');}
    finally{clearTimeout(wait);}
  }
  function autoFinish(){if(recording&&!busy)void stop();}
  function monitorSpeech(source){
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC){report('Listening… Tap once more to send.','listening');return;}
    try{
      audioContext=new AC();sourceNode=audioContext.createMediaStreamSource(source);
      analyser=audioContext.createAnalyser();analyser.fftSize=1024;
      sourceNode.connect(analyser);
      const buffer=new Float32Array(analyser.fftSize);let consecutive=0, lastLoudAt=0;
      detectionTimer=setInterval(()=>{
        if(!recording||document.hidden)return;
        analyser.getFloatTimeDomainData(buffer);
        let sum=0;for(let i=0;i<buffer.length;i++)sum+=buffer[i]*buffer[i];
        const rms=Math.sqrt(sum/buffer.length);
        const now=Date.now(), elapsed=now-startedAt;
        // Initial local noise floor; calibrate slowly on quieter frames.
        if(!hasSpeech && elapsed<950)baseline=baseline*.9+Math.min(rms,.04)*.1;
        const threshold=Math.max(.013,Math.min(.052,baseline*3.0));
        const loud=rms>threshold;
        peak=Math.max(peak,rms);
        if(loud){
          consecutive++;
          if(consecutive>=5){hasSpeech=true;lastSpeechAt=now;lastLoudAt=now;if(!speechSince)speechSince=now;}
        }else consecutive=0;
        // Avoid cutting off natural pauses; require sustained speech and silence.
        if(hasSpeech && elapsed>2000 && now-speechSince>=MIN_SPEECH_MS && now-lastSpeechAt>SILENCE_MS){autoFinish();return;}
        if(!hasSpeech && elapsed>NO_SPEECH_MS){
          // iPhone microphones vary substantially in gain. If the detector never
          // crosses its threshold, send the capture for transcription instead
          // of silently discarding the user's speech.
          autoFinish();
        }
      },110);
    }catch(e){releaseAudio();report('Listening… Tap again to finish speaking.','listening');}
  }
  async function start(){
    if(busy||recording)return;
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){report('Recording unavailable. Open AUREN in Safari over HTTPS.','error');return;}
    busy=true;finishing=false;const token=++generation;
    report('Connecting microphone…','processing');
    try{
      // Request permission immediately inside user tap, without awaiting anything first.
      const obtained=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,channelCount:1}});
      if(token!==generation){obtained.getTracks().forEach(t=>t.stop());return;}
      obtained.getAudioTracks().forEach(t=>{t.onended=()=>{if(token!==generation||finishing)return; ++generation;cleanup();busy=false;finishing=false;report('Microphone disconnected. Tap once to reconnect.','error');};});
      stream=obtained;chunks=[];hasSpeech=false;speechSince=0;lastSpeechAt=0;baseline=.006;peak=0;
      const kind=mime();const r=new MediaRecorder(obtained,kind?{mimeType:kind}:undefined);recorder=r;
      r.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
      r.onerror=()=>{if(token!==generation)return; ++generation;cleanup();busy=false;finishing=false;report('Recording failed. Tap once to retry.','error');};
      r.onstop=async()=>{
        if(token!==generation)return;
        clearTimeout(stopWatchdog);stopWatchdog=null;
        const blob=new Blob(chunks,{type:r.mimeType||kind||'audio/mp4'});
        chunks=[];cleanup();busy=true;
        try{await upload(blob);}finally{busy=false;finishing=false;}
      };
      r.start(250);recording=true;startedAt=Date.now();
      report('I’m listening… Speak normally; pause when finished.','listening');
      monitorSpeech(obtained);
      timeout=setTimeout(autoFinish,MAX_MS);
    }catch(error){cleanup();report(error.name==='NotAllowedError'?'Microphone denied. Allow it in Safari Website Settings.':'Microphone problem: '+error.message,'error');}
    finally{if(!recording)busy=false;else busy=false;}
  }
  async function stop(){
    if(!recording||!recorder||busy||finishing)return;
    finishing=true;busy=true;recording=false;releaseAudio();clearTimeout(timeout);timeout=null;
    report('Processing your message…','processing');
    try{if(recorder.state==='recording'){
      try{recorder.requestData();}catch{}
      recorder.stop();
      stopWatchdog=setTimeout(()=>{
        if(!finishing||!busy)return;
        // WebKit sometimes fails to dispatch the stop event. Restore the next-turn control.
        ++generation;cleanup();busy=false;finishing=false;
        report('Recorder reset. Tap the orb once to speak again.','error');
      },6500);
    }else{cleanup();busy=false;finishing=false;}}
    catch(error){cleanup();busy=false;finishing=false;report('Could not finish recording: '+error.message,'error');}
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden&&(recording||stream)){
      ++generation;const r=recorder;chunks=[];cleanup();busy=false;finishing=false;
      try{if(r?.state==='recording')r.stop();}catch{}
      report('Microphone off while Safari is in the background.','idle');
    }
  });
  return {start,stop,get recording(){return recording;},get busy(){return busy;}};
}
