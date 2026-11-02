// AUREN v2.91 — Load the fixed schedule engine instead of any cached previous version.
// AUREN v2.89 — Matching loader for robust speech/schedule reading.
// AUREN v2.88 — Matching app loader for unified schedule reading.
// AUREN v2.87 — flexible natural requests, version-matched loader.
// AUREN v2.86 — Patience voice engine with matching app and diagnostic versions.
// AUREN v2.85 — Loader verified to request current app.js and report accurate diagnostics.
// AUREN v2.84 — Matching app loader and diagnostics.
// AUREN v2.84 — Verified reminder entries and matching app loader.
// AUREN v2.82 — Loads verified name recall upgrade.
// AUREN v2.81 — Versioned Safari loader for reliable reminder routing.
// AUREN v2.80.1 — Safari loader and diagnostics for v2.80.1.
// AUREN v2.80 — Updated verified loader and diagnostics.
// AUREN v2.79 — Correct version diagnostics and v2.79 module loader.
// AUREN v2.78 — consistent loader for conversation continuity update.
// AUREN v2.77 — version-aware startup diagnostics and deployment checks.
// Preserves v2.72.2 Firebase sign-in and cloud sync.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, setPersistence, browserLocalPersistence, browserSessionPersistence } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { mountCloudTransfer } from './cloud-sync.js?v=2.9.0';
const firebaseConfig = {
  apiKey: 'AIzaSyB5up3qmH2miZHO0H164vCe9O6maXKMRPU',
  authDomain: 'auren-90588.firebaseapp.com',
  projectId: 'auren-90588',
  storageBucket: 'auren-90588.firebasestorage.app',
  messagingSenderId: '258218773081',
  appId: '1:258218773081:web:6afae5596fc3b33a7bf48'
};
const gate=document.getElementById('aurenAuthGate');
const button=document.getElementById('aurenGoogleSignIn');
const status=document.getElementById('aurenAuthStatus');
const accountCard=document.getElementById('aurenAccountCard');
const accountEmail=document.getElementById('aurenAccountEmail');
const logout=document.getElementById('aurenSignOut');
const intro=gate?.querySelector('.auren-auth-panel > p');
let currentUser=null, appPromise=null, loaded=false, mountedUserId=null, busy=false;
let diagnosticReport='';
const message=v=>{if(status)status.textContent=v;};
const gateVisible=visible=>{if(gate)gate.hidden=!visible;document.body.classList.toggle('auren-auth-locked',visible);};
function setGateMode(mode, explanation=''){
  gateVisible(mode!=='ready');
  if(button){button.hidden=mode!=='signin'&&mode!=='error';button.disabled=false;button.textContent=mode==='error'?'Retry opening AUREN':'Continue with Google';}
  if(intro)intro.textContent=mode==='checking'?'':mode==='signin'?'Sign in to continue.':mode==='loading'?'':'Unable to load AUREN.';
  message(explanation || (mode==='checking'?'':mode==='loading'?'Opening AUREN…':mode==='signin'?'':'AUREN is ready.'));
}
function friendlyError(error){
  const code=String(error?.code||'');
  if(code.includes('popup-closed-by-user')||code.includes('cancelled-popup-request'))return 'Sign-in was cancelled.';
  if(code.includes('popup-blocked'))return 'Safari blocked the sign-in popup. Allow pop-ups for this site.';
  if(code.includes('unauthorized-domain'))return 'This website must be added to Firebase authorized domains.';
  if(code.includes('network-request-failed'))return 'Could not reach Google. Check your connection.';
  return error?.message||'Unable to sign in.';
}
// These paths match app.js's direct imports. If the app fails to load,
// isolate which dependency cannot be imported, rather than blaming auth.js.
const APP_DEPENDENCIES = [
  './db.js', './memory.js', './projects.js', './sensitive.js',
  './butler.js', './backup.js', './settings.js',
  './voice.js?v=2.9.9', './iphone-voice.js?v=2.9.5',
  './ai.js', './weather.js'
];
function errorDetails(error) {
  const details = [error?.name || 'Error', error?.message || String(error)];
  if (error?.fileName) details.push('file: ' + error.fileName);
  if (Number.isFinite(error?.lineNumber)) details.push('line: ' + error.lineNumber);
  if (Number.isFinite(error?.columnNumber)) details.push('column: ' + error.columnNumber);
  if (error?.stack) details.push('stack: ' + String(error.stack).slice(0,900));
  return details.join(' | ');
}
function diagnosticElements() {
  let panel=document.getElementById('aurenStartupDiagnostics');
  if(panel)return panel;
  panel=document.createElement('section');panel.id='aurenStartupDiagnostics';
  panel.setAttribute('role','status');
  panel.style.cssText='max-width:520px;margin:16px auto 0;padding:12px;text-align:left;border:1px solid #b69b64;border-radius:10px;color:#e8d8b8;background:#191a20;font:13px/1.5 system-ui,sans-serif;max-height:42vh;overflow:auto;';
  const heading=document.createElement('strong');heading.textContent='AUREN Startup Diagnostics';
  const output=document.createElement('pre');output.id='aurenDiagnosticsText';
  output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,Menlo,monospace;';
  const copy=document.createElement('button');copy.type='button';copy.textContent='Copy Error Report';
  copy.style.cssText='background:#c7a669;color:#151515;padding:10px 18px;border-radius:8px;border:0;font-weight:700;cursor:pointer;';
  copy.addEventListener('click',async()=>{
    try { await navigator.clipboard.writeText(diagnosticReport);copy.textContent='Report copied!'; }
    catch(error) {
      const field=document.createElement('textarea');field.value=diagnosticReport;field.style.cssText='width:100%;height:140px';panel.append(field);field.select();copy.textContent='Select and copy the report below';
    }
  });
  panel.append(heading,output,copy);
  (gate?.querySelector('.auren-auth-panel') || gate || document.body).append(panel);
  return panel;
}
function displayDiagnosis(report) {
  diagnosticReport=report;
  const panel=diagnosticElements();panel.hidden=false;
  const output=panel.querySelector('#aurenDiagnosticsText');
  if(output)output.textContent=report;
}
async function runStartupDiagnosis(error) {
  const entries=[
    'AUREN diagnostics v2.84',
    'Reported at: '+new Date().toISOString(),
    'Page: '+location.pathname,
    'Application: app.js?v=2.90',
    'Original failure: '+errorDetails(error),
    'Checking deployed application source and dependencies...'
  ];
  displayDiagnosis(entries.join('\n'));
  try {
    // Explicit cache bypass lets us distinguish an outdated deployed app.js from a broken module.
    const sourceURL=new URL('./app.js?v=2.90',import.meta.url);
    sourceURL.searchParams.set('diagnostics',String(Date.now()));
    const sourceResponse=await fetch(sourceURL.href,{cache:'no-store'});
    if(!sourceResponse.ok)throw new Error('HTTP '+sourceResponse.status+' loading deployed app.js');
    const source=await sourceResponse.text();
    const head=source.split('\n').slice(0,4).join(' | ').slice(0,300);
    entries.push('Deployed app.js header: '+head);
    entries.push('Deployed app.js size: '+new TextEncoder().encode(source).length+' bytes');
    if(!/^\/\/ AUREN v2\.83\b/m.test(source.slice(0,400))) {
      entries.push('VERSION MISMATCH: deployed app.js does not begin with AUREN v2.84. Check GitHub commit, Pages deployment, and refresh.');
    } else entries.push('Application version matches v2.84.');
  } catch(sourceError){entries.push('Could not verify deployed app.js: '+errorDetails(sourceError));}
  displayDiagnosis(entries.join('\n'));
  const failed=[];
  // Importing one module at a time gives its own error instead of just app.js's error.
  // Some modules import one another; a failure can therefore involve a dependency.
  for(const path of APP_DEPENDENCIES) {
    try {
      const url=new URL(path,import.meta.url);
      const response=await fetch(url.href,{cache:'no-store'});
      if(!response.ok)throw new Error('HTTP '+response.status+' while loading this file');
      await import(path);
      entries.push('OK   '+path);
    } catch(moduleError) {
      failed.push({path,error:moduleError});
      entries.push('FAIL '+path+' — '+errorDetails(moduleError));
    }
    displayDiagnosis(entries.join('\n'));
  }
  if(failed.length===1)entries.push('LIKELY PROBLEM FILE: '+failed[0].path+' (or one of its imports)');
  else if(failed.length>1)entries.push('FAILING IMPORTS: '+failed.map(x=>x.path).join(', ')+'. One shared dependency may be responsible.');
  else entries.push('All direct dependencies imported. The remaining error is likely inside app.js itself or during its startup execution.');
  entries.push('Send this report to the developer. Diagnostics do not modify saved data.');
  displayDiagnosis(entries.join('\n'));
}

async function openApp(user){
  if(!user||busy)return;
  if(loaded){setGateMode('ready');return;}
  busy=true;setGateMode('loading');
  try{
    // A fresh versioned URL makes Safari request the CURRENT deployed app.js.
    if(!appPromise)appPromise=import('./app.js?v=2.90').catch(error=>{appPromise=null;throw error;});
    await appPromise;loaded=true;
    if(accountEmail)accountEmail.textContent=user.email||'Signed in';
    if(accountCard)accountCard.hidden=false;
    const oldDiag=document.getElementById('aurenStartupDiagnostics');if(oldDiag)oldDiag.hidden=true;
    setGateMode('ready');
    if(mountedUserId!==user.uid){
      mountedUserId=user.uid;
      try{await mountCloudTransfer(firebaseApp,user,accountCard);}catch(error){console.warn('Cloud sync unavailable',error);}
    }
  }catch(error){
    console.error('AUREN application failed to load after sign-in:',error);
    setGateMode('error','Signed in, but the app could not start: '+String(error?.message||error).slice(0,160));
    try { await runStartupDiagnosis(error); } catch(diagnosticError) {console.error('AUREN diagnostics failed',diagnosticError);displayDiagnosis('Diagnostics failed: '+errorDetails(diagnosticError)+'\nOriginal error: '+errorDetails(error));}
  }finally{busy=false;}
}
let firebaseApp,auth;
setGateMode('checking');
try{
  firebaseApp=initializeApp(firebaseConfig);auth=getAuth(firebaseApp);
  try{await setPersistence(auth,browserLocalPersistence);}
  catch(error){console.warn('Persistent login unavailable; trying this session',error);try{await setPersistence(auth,browserSessionPersistence);}catch(err){console.warn('Browser session persistence unavailable',err);}}
  button?.addEventListener('click',async()=>{
    if(busy)return;
    if(currentUser){await openApp(currentUser);return;}
    button.disabled=true;
    try{const result=await signInWithPopup(auth,new GoogleAuthProvider());currentUser=result.user;await openApp(currentUser);}
    catch(error){console.error('Google sign-in failed',error);setGateMode('signin',friendlyError(error));}
    finally{button.disabled=false;}
  });
  logout?.addEventListener('click',async()=>{
    try{await signOut(auth);location.reload();}catch(error){console.error('Sign out failed',error);}
  });
  onAuthStateChanged(auth,user=>{
    currentUser=user;
    if(user){void openApp(user);}
    else if(!busy)setGateMode('signin');
  },error=>{console.error('Session check failed',error);setGateMode('signin','Please sign in to continue.');});
}catch(error){console.error('Firebase initialization failed',error);setGateMode('error','Unable to initialize sign-in: '+String(error?.message||error).slice(0,150));}
