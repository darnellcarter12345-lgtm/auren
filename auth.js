// AUREN v2.15.1 — safer Google sign-in diagnostics and retry handling.
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
const gate = document.getElementById('aurenAuthGate');
const button = document.getElementById('aurenGoogleSignIn');
const status = document.getElementById('aurenAuthStatus');
const accountCard = document.getElementById('aurenAccountCard');
const accountEmail = document.getElementById('aurenAccountEmail');
const logout = document.getElementById('aurenSignOut');
let loaded = false;
let loading = false;
let mountedFor = null;
let currentUser = null;
let auth = null;
let firebaseApp = null;
let persistenceNote = '';
const say = message => { if (status) status.textContent = message; };
function unlock() { gate && (gate.hidden = true); document.body.classList.remove('auren-auth-locked'); }
function lock() { document.body.classList.add('auren-auth-locked'); if (gate) gate.hidden = false; if (accountCard) accountCard.hidden = true; }
function friendlyError(error) {
  const code = String(error?.code || '');
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return 'Sign-in was cancelled. Try again when ready.';
  if (code.includes('unauthorized-domain')) return 'This domain is not authorized in Firebase. Add darnellcarter12345-lgtm.github.io to Authentication > Settings > Authorized domains.';
  if (code.includes('popup-blocked')) return 'Safari blocked the Google login window. Allow pop-ups for this site.';
  if (code.includes('network-request-failed')) return 'Google sign-in could not reach Firebase. Check your connection or browser content blockers.';
  if (code.includes('web-storage-unsupported') || code.includes('storage')) return 'Safari storage may be unavailable. Try a normal (not Private) Safari window.';
  return `Google sign-in failed${code ? ` (${code})` : ''}. Check Safari’s JavaScript console for details.`;
}
function ensureRetryButton() {
  if (!button) return;
  button.disabled = false;
  button.textContent = 'Retry opening AUREN';
}
async function openAuren(user) {
  if (loading || loaded || !user) return;
  loading = true;
  say('Signed in. Loading AUREN…');
  try {
    // Cache-bust this module so a failed, stale script is not silently reused.
    await import('./app.js?v=2.15.1');
    loaded = true;
    unlock();
    say('AUREN is ready.');
    if (accountCard) accountCard.hidden = false;
    if (accountEmail) accountEmail.textContent = user.email || 'Signed in';
    if (mountedFor !== user.uid) {
      try { mountCloudTransfer(firebaseApp, user, accountCard); mountedFor = user.uid; }
      catch (e) { console.warn('AUREN cloud sync could not start:', e); }
    }
  } catch (error) {
    loaded = false;
    console.error('AUREN APP LOAD ERROR (sign-in succeeded):', error);
    lock();
    say(`Google sign-in worked, but AUREN could not load: ${String(error?.message || error).slice(0,220)}. Open Safari > Develop > Show JavaScript Console for the detailed error.`);
    ensureRetryButton();
  } finally { loading = false; }
}
try {
  firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  try { await setPersistence(auth, browserLocalPersistence); }
  catch (error) {
    console.warn('Local login persistence unavailable:', error);
    try { await setPersistence(auth, browserSessionPersistence); persistenceNote = ' Login is limited to this browser session.'; }
    catch (secondError) { console.warn('Session persistence unavailable:', secondError); persistenceNote = ' Safari may not remember your login.'; }
  }
  button?.addEventListener('click', async () => {
    button.disabled = true;
    if (currentUser) { await openAuren(currentUser); button.disabled = false; return; }
    say('Opening Google sign-in…');
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      currentUser = result.user;
      await openAuren(result.user);
    } catch (error) {
      console.error('AUREN AUTH ERROR:', error);
      say(friendlyError(error) + persistenceNote);
    } finally { button.disabled = false; }
  });
  logout?.addEventListener('click', async () => {
    try { await signOut(auth); location.reload(); }
    catch (error) { console.error('AUREN sign-out failed:', error); alert('Sign out failed. Please try again.'); }
  });
  onAuthStateChanged(auth, user => {
    currentUser = user;
    if (!user) { lock(); say('Sign in to continue. Your device data is kept.' + persistenceNote); return; }
    void openAuren(user);
  }, error => {
    console.error('AUREN auth state check failed:', error);
    lock(); say('Could not verify your session: ' + friendlyError(error));
  });
} catch (error) {
  console.error('AUREN Firebase initialization failed:', error);
  lock(); say('Login could not initialize: ' + String(error?.message || error).slice(0,200));
}
