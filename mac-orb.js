// AUREN — Mac-only orb visuals v3.27
// Does not start/stop microphones, change voices, or override AUREN's listeners.
(() => {
  'use strict';
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS || !/Macintosh|MacIntel/i.test(navigator.userAgent + ' ' + navigator.platform)) return;
  const id = 'auren-mac-orb-327';
  if (document.getElementById(id)) return;
  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    body.auren-mac-orb #orbControl {
      transition: filter .23s ease, box-shadow .23s ease, transform .23s ease;
      will-change: filter, box-shadow;
    }
    body.auren-mac-orb[data-auren-mac-phase="idle"] #orbControl {
      filter:brightness(.88);box-shadow:0 0 20px rgba(214,181,123,.24);
    }
    body.auren-mac-orb[data-auren-mac-phase="listening"] #orbControl {
      animation: aurenMacListening327 1.75s ease-in-out infinite;
    }
    body.auren-mac-orb[data-auren-mac-phase="processing"] #orbControl {
      animation: aurenMacThinking327 2.4s ease-in-out infinite;
    }
    body.auren-mac-orb[data-auren-mac-phase="speaking"] #orbControl {
      animation: aurenMacSpeaking327 1.1s ease-in-out infinite;
    }
    body.auren-mac-orb #orbControl.auren-mac-pulse {
      filter:brightness(1.35)!important;
      box-shadow:0 0 0 8px rgba(214,181,123,.2),0 0 65px rgba(214,181,123,.8)!important;
    }
    @keyframes aurenMacListening327 { 50% {filter:brightness(1.18); box-shadow:0 0 0 13px rgba(214,181,123,.12),0 0 57px rgba(214,181,123,.75);}}
    @keyframes aurenMacThinking327 { 50% {filter:brightness(1.07);box-shadow:0 0 0 7px rgba(214,181,123,.10),0 0 39px rgba(214,181,123,.48);}}
    @keyframes aurenMacSpeaking327 { 50% {filter:brightness(1.23);box-shadow:0 0 0 12px rgba(214,181,123,.18),0 0 63px rgba(214,181,123,.85);}}
    @media (prefers-reduced-motion: reduce) {
      body.auren-mac-orb #orbControl {animation:none!important;transition:none!important;}
    }
  `;
  document.head.appendChild(style);
  let pulseTimeout;
  const init = () => {
    const orb = document.getElementById('orbControl');
    const status = document.getElementById('voiceStatus');
    if (!orb || !status || !document.body || document.body.classList.contains('auren-mac-orb')) return;
    document.body.classList.add('auren-mac-orb');
    const paint = () => {
      const base = document.body.dataset.voiceState;
      const state = ['idle','listening','processing','speaking'].includes(base) ? base : 'idle';
      if (document.body.dataset.aurenMacPhase !== state) document.body.dataset.aurenMacPhase = state;
    };
    orb.addEventListener('click', () => {
      orb.classList.remove('auren-mac-pulse');
      void orb.offsetWidth;
      orb.classList.add('auren-mac-pulse');
      clearTimeout(pulseTimeout);
      pulseTimeout = setTimeout(() => orb.classList.remove('auren-mac-pulse'), 380);
    }, {passive:true});
    const observer = new MutationObserver(paint);
    observer.observe(document.body, {attributes:true,attributeFilter:['data-voice-state']});
    observer.observe(status, {characterData:true,subtree:true,childList:true});
    paint();
    window.addEventListener('pagehide', () => {clearTimeout(pulseTimeout);observer.disconnect();},{once:true});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
