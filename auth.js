import { getFirestore, doc, getDoc, setDoc, getDocs, collection, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
// AUREN v3.21 — per-account local data gate.
// AUREN v3.21 — matching cache-busted application loader.
// AUREN v3.21 — matching cache-busted app loader.
// AUREN v3.14 — Voice-output check-ins independent of microphone.
// AUREN v3.13 — Load independent check-in patch with original voice behavior.
// AUREN v3.11 — matched application loader.
// AUREN v3.01 — location fix loader.
// AUREN v3.01 — updated app loader for context-and-care engine.
// AUREN v3.01 — matching cache-busting loader.
// AUREN v2.93 — verified app.js version loader.
// AUREN v2.92 — correct app.js cache version and profile recall build.
// AUREN v2.92 — Load the fixed schedule engine instead of any cached previous version.
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

// v3.21 Account-scoped browser storage. This executes before app.js starts.
// Never assign unowned legacy data to an arbitrary newly signed-in user.
const ACCOUNT_PREFIX='auren_account_v321_';
const ACTIVE_ACCOUNT='auren_account_active_uid_v321';
const RESERVED_AUREN_KEYS=new Set([ACTIVE_ACCOUNT,'auren_cloud_device_owner_v1','auren_account_legacy_notice_v321']);
function accountDataKey(uid,key){return ACCOUNT_PREFIX+uid+'::'+key;}
function appDataKeys(){return Object.keys(localStorage).filter(k=>k.startsWith('auren_')&&!k.startsWith(ACCOUNT_PREFIX)&&!k.startsWith('auren_legacy_unassigned_v321::')&&!RESERVED_AUREN_KEYS.has(k)&&!/^auren_(?:sync_enabled_v29_|sync_baseline_v29_|pre_sync_backup_)/.test(k));}
function storeCurrentAccount(uid){
  if(!uid)return;
  const keys=appDataKeys();
  // All writes complete before any shared key is removed.
  for(const k of keys)localStorage.setItem(accountDataKey(uid,k),localStorage.getItem(k));
  for(const k of keys)localStorage.removeItem(k);
}
function restoreAccount(uid){
  for(const k of Object.keys(localStorage)){
    if(!k.startsWith(ACCOUNT_PREFIX+uid+'::'))continue;
    localStorage.setItem(k.slice((ACCOUNT_PREFIX+uid+'::').length),localStorage.getItem(k));
  }
}
function activateAccountStorage(uid){
  if(!uid)throw Error('Missing signed-in account ID');
  const prior=localStorage.getItem(ACTIVE_ACCOUNT);
  const oldOwner=localStorage.getItem('auren_cloud_device_owner_v1');
  if(prior===uid){sessionStorage.setItem('auren_account_uid_v321',uid);return;}
  if(prior)storeCurrentAccount(prior);
  else{
    const existing=appDataKeys();
    if(existing.length){
      if(oldOwner===uid){storeCurrentAccount(uid);} // certified legacy owner
      else{
        // Protect legacy data, but don't expose it to a different account.
        for(const k of existing)localStorage.setItem('auren_legacy_unassigned_v321::'+k,localStorage.getItem(k));
        for(const k of existing)localStorage.removeItem(k);
        localStorage.setItem('auren_account_legacy_notice_v321','yes');
      }
    }
  }
  restoreAccount(uid);
  localStorage.setItem(ACTIVE_ACCOUNT,uid);
  // Cloud sync's previous global owner flag is now scoped to the active account.
  localStorage.setItem('auren_cloud_device_owner_v1',uid);
  sessionStorage.setItem('auren_account_uid_v321',uid);
}

const gate=document.getElementById('aurenAuthGate');
// AUREN v3.47 — Firebase account approval (GitHub UI gate, not Worker authorization).
const AUREN_OWNER_UID = "uQ6OTPvqJKbgU26CmjQ5C4B6taw2";
const aurenAccessDb = () => getFirestore(firebaseApp);
const aurenAccessRef = uid => doc(aurenAccessDb(), 'aurenAccess', uid);
const aurenIsOwner = user => !!user && user.uid === AUREN_OWNER_UID;
const aurenAccessStyle = `
  .a47-box{font:14px/1.5 system-ui,sans-serif;color:#e9e1d4;margin:16px auto;padding:16px;max-width:420px;background:#191c23;border:1px solid #8f774f;border-radius:15px;box-sizing:border-box}
  .a47-box h3{margin:0 0 10px;font:20px Georgia,serif;color:#e3bf83}
  .a47-box p{margin:8px 0;color:#c7bfaf}
  .a47-box input{width:100%;box-sizing:border-box;border-radius:9px;background:#0d1016;color:#fff;border:1px solid #877049;padding:12px;margin:6px 0}
  .a47-box button{background:#d9b578;color:#17130d;border:0;border-radius:8px;padding:10px 14px;margin:6px 6px 6px 0;font-weight:700;cursor:pointer}
  .a47-box button:disabled{opacity:.5;cursor:wait}
  .a47-entry{border-top:1px solid #5f5544;padding:12px 0;overflow-wrap:anywhere}
`;
const aurenAccessCSS = document.createElement('style');aurenAccessCSS.textContent=aurenAccessStyle;document.head.append(aurenAccessCSS);
function aurenAccessPanel(){
 let panel=document.getElementById('aurenAccessPanel');
 if(!panel){ panel=document.createElement('section'); panel.id='aurenAccessPanel';panel.className='a47-box';panel.setAttribute('aria-live','polite');
 (gate?.querySelector('.auren-auth-panel')||gate||document.body).append(panel); }
 panel.hidden=false; return panel;
}
function aurenAccessClear(){let p=document.getElementById('aurenAccessPanel');if(p)p.hidden=true;}
function aurenShowError(messageText){const panel=aurenAccessPanel();panel.replaceChildren();const h=document.createElement('h3');h.textContent='AUREN Private Access';const p=document.createElement('p');p.textContent=messageText;panel.append(h,p);}
async function aurenCheckApproval(user){
 if(aurenIsOwner(user))return true;
 const snap=await getDoc(aurenAccessRef(user.uid));
 return snap.exists() && snap.data().status === 'approved';
}
async function aurenRequestView(user){
 setGateMode('checking');const panel=aurenAccessPanel();panel.replaceChildren();
 const heading=document.createElement('h3');heading.textContent='Request access to AUREN';panel.append(heading);
 const intro=document.createElement('p');intro.textContent='Your Google account: '+(user.email||'signed in');panel.append(intro);
 const name=document.createElement('input');name.maxLength=70;name.autocomplete='name';name.placeholder='Your name';name.value=(user.displayName||'').slice(0,70);name.setAttribute('aria-label','Your name');panel.append(name);
 const note=document.createElement('p');note.textContent='You only need approval once for this Google account.';panel.append(note);
 const request=document.createElement('button');request.type='button';request.textContent='Request access';panel.append(request);
 const check=document.createElement('button');check.type='button';check.textContent='Check approval';panel.append(check);
 const signout=document.createElement('button');signout.type='button';signout.textContent='Use a different Google account';panel.append(signout);
 const feedback=document.createElement('p');feedback.setAttribute('role','status');panel.append(feedback);
 request.onclick=async()=>{
   if(!name.value.trim()){feedback.textContent='Please enter your name.';return;}
   request.disabled=true;
   try{
     const ref=aurenAccessRef(user.uid);const prior=await getDoc(ref);
     if(prior.exists()){feedback.textContent=prior.data().status==='denied'?'This account was denied. Contact the owner.':'Your request is already recorded. Check approval after the owner accepts.';return;}
     await setDoc(ref,{name:name.value.trim(),email:user.email||'',status:'pending',requestedAt:serverTimestamp()});
     feedback.textContent='Request submitted. The owner can now approve you.';
   }catch(e){feedback.textContent='Could not submit request: '+(e.code||e.message||e);}
   finally{request.disabled=false;}
 };
 check.onclick=async()=>{
   check.disabled=true;feedback.textContent='Checking…';
   try{const snap=await getDoc(aurenAccessRef(user.uid));if(snap.exists()&&snap.data().status==='approved'){aurenAccessClear();await openApp(user);return;}
      feedback.textContent=snap.exists()&&snap.data().status==='denied'?'Access denied by owner.':'Still waiting for approval.';
   }catch(e){feedback.textContent='Could not check approval: '+(e.code||e.message||e);}
   finally{check.disabled=false;}
 };
 signout.onclick=()=>signOut(auth).then(()=>location.reload());
}
async function aurenOwnerDashboard(user){
 if(!aurenIsOwner(user))return;
 const card=accountCard||document.body;
 let trigger=document.getElementById('aurenOwnerOpen');
 if(!trigger){trigger=document.createElement('button');trigger.id='aurenOwnerOpen';trigger.type='button';trigger.textContent='Owner · Access Requests';trigger.style.cssText='padding:9px 12px;margin:10px 0;border:1px solid #caa568;border-radius:8px;background:#1b1a20;color:#e1bd81;cursor:pointer;';card.append(trigger);}
 let board=document.getElementById('aurenOwnerBoard');
 if(!board){board=document.createElement('section');board.id='aurenOwnerBoard';board.className='a47-box';board.hidden=true;card.append(board);}
 trigger.onclick=()=>{board.hidden=!board.hidden;if(!board.hidden)void draw();};
 async function draw(){
    board.replaceChildren();const h=document.createElement('h3');h.textContent='Owner · Access Requests';board.append(h);
    const refresh=document.createElement('button');refresh.textContent='Refresh';board.append(refresh);refresh.onclick=draw;
    const msg=document.createElement('p');msg.textContent='Loading account requests…';board.append(msg);
    try{
      const records=await getDocs(collection(aurenAccessDb(),'aurenAccess'));
      msg.textContent=records.empty?'No access requests yet.':'Each approval belongs to one Google account, not a device.';
      const entries=records.docs.map(d=>({uid:d.id,...d.data()})).sort((a,b)=>({pending:0,approved:1,denied:2}[a.status]??3)-({pending:0,approved:1,denied:2}[b.status]??3));
      entries.forEach(record=>{
        const entry=document.createElement('div');entry.className='a47-entry';
        const title=document.createElement('strong');title.textContent=(record.name||'Unnamed')+' · '+(record.status||'unknown');entry.append(title);
        const line=document.createElement('p');line.textContent=record.email||record.uid;entry.append(line);
        if(record.status!=='approved'){
          const yes=document.createElement('button');yes.textContent='Approve';yes.onclick=()=>change(record.uid,'approved',yes);entry.append(yes);
        }
        if(record.status!=='denied'){
          const no=document.createElement('button');no.textContent=record.status==='approved'?'Revoke':'Deny';no.onclick=()=>change(record.uid,'denied',no);entry.append(no);
        }
        board.append(entry);
      });
    }catch(e){msg.textContent='Could not load requests: '+(e.code||e.message||e)+'. Check your Firestore rules.';}
 }
 async function change(uid,status,btn){
    btn.disabled=true;
    try{await updateDoc(aurenAccessRef(uid),{status,reviewedAt:serverTimestamp()});await draw();}
    catch(e){alert('Unable to update access: '+(e.code||e.message||e));btn.disabled=false;}
 }
}

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
  './voice.js?v=3.21', './iphone-voice.js?v=3.21',
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
    'AUREN diagnostics v2.93',
    'Reported at: '+new Date().toISOString(),
    'Page: '+location.pathname,
    'Application: app.js?v=3.21',
    'Original failure: '+errorDetails(error),
    'Checking deployed application source and dependencies...'
  ];
  displayDiagnosis(entries.join('\n'));
  try {
    // Explicit cache bypass lets us distinguish an outdated deployed app.js from a broken module.
    const sourceURL=new URL('./app.js?v=3.21',import.meta.url);
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
    // v3.47: only approved users load AUREN. Owner always permitted.
    let permitted=false;
    try{permitted=await aurenCheckApproval(user);}
    catch(e){aurenShowError('Unable to check approval. Check Firestore setup: '+(e.code||e.message||e));return;}
    if(!permitted){await aurenRequestView(user);return;}
    aurenAccessClear();
    activateAccountStorage(user.uid);
    // A fresh versioned URL makes Safari request the CURRENT deployed app.js.
    if(!appPromise)appPromise=import('./app.js?v=3.21').catch(error=>{appPromise=null;throw error;});
    await appPromise;loaded=true;
    if(accountEmail)accountEmail.textContent=user.email||'Signed in';
    if(accountCard)accountCard.hidden=false;
    if(aurenIsOwner(user))void aurenOwnerDashboard(user);
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
