// AUREN v2.72.2 — fresh app module loading after sign-in.
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
async function openApp(user){
  if(!user||busy)return;
  if(loaded){setGateMode('ready');return;}
  busy=true;setGateMode('loading');
  try{
    // A fresh versioned URL makes Safari request the CURRENT deployed app.js.
    if(!appPromise)appPromise=import('./app.js?v=2.72.2').catch(error=>{appPromise=null;throw error;});
    await appPromise;loaded=true;
    if(accountEmail)accountEmail.textContent=user.email||'Signed in';
    if(accountCard)accountCard.hidden=false;
    setGateMode('ready');
    if(mountedUserId!==user.uid){
      mountedUserId=user.uid;
      try{await mountCloudTransfer(firebaseApp,user,accountCard);}catch(error){console.warn('Cloud sync unavailable',error);}
    }
  }catch(error){
    console.error('AUREN application failed to load after sign-in:',error);
    setGateMode('error','Signed in, but the app could not start: '+String(error?.message||error).slice(0,160));
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
