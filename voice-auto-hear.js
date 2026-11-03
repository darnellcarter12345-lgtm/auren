// AUREN — auto-enable spoken replies when initiating a voice conversation v3.27
// Leaves all existing microphone and playback handlers in control.
(() => {
  'use strict';
  const INIT_KEY = 'auren-auto-hear-327';
  if (document.documentElement.dataset.aurenAutoHear === INIT_KEY) return;
  document.documentElement.dataset.aurenAutoHear = INIT_KEY;
  const iOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const PREF = 'auren_speech_replies_v2161';
  // Run before the main app's click handler without stopping its event.
  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('#orbControl, #micBtn, #aurenIPhoneTalk');
    if (!button || button.disabled) return;
    const checkbox = document.getElementById('speakReplies');
    if (!checkbox || checkbox.disabled || checkbox.checked) return;
    checkbox.checked = true;
    try { localStorage.setItem(PREF, 'true'); } catch {}
    if (!iOS) {
      // Desktop: app.js already has a checkbox change handler that enables
      // speech and unlocks playback from this user gesture.
      checkbox.dispatchEvent(new Event('change', {bubbles:true}));
    }
    // iPhone: do NOT call primeAudio here. It competes with getUserMedia.
    // app.js's onText callback calls voice.setEnabled(checkbox.checked)
    // after capture, keeping microphone and speech sessions separate.
  }, {capture:true});
})();
