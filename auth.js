// AUREN Firebase Google sign-in gate — Part 1
// Firebase config fields are public app identifiers, not secret credentials.
// No existing local memories, appointments or projects are altered by this file.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyB5up3qmH2miZHOOHl64vCe9O6maXKMRPU',
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
let appLoaded = false;
let auth;

function say(message) { if (status) status.textContent = message; }
function unlock() {
  if (gate) gate.hidden = true;
  document.body.classList.remove('auren-auth-locked');
}
function lock() {
  document.body.classList.add('auren-auth-locked');
  if (gate) gate.hidden = false;
  if (accountCard) accountCard.hidden = true;
}
function userError(error) {
  const code = String(error?.code || '');
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return 'Sign-in was cancelled. You can try again.';
  if (code.includes('unauthorized-domain')) return 'Add darnellcarter12345-lgtm.github.io under Firebase Authentication > Settings > Authorized domains.';
  if (code.includes('popup-blocked')) return 'Safari blocked the Google sign-in window. Allow pop-ups for AUREN, then tap again.';
  if (code.includes('operation-not-supported')) return 'This browser is blocking Google sign-in. Try opening AUREN in Safari directly.';
  return 'Sign-in could not complete. Check your connection and Firebase Authentication settings.';
}

try {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  button?.addEventListener('click', async () => {
    button.disabled = true;
    say('Opening Google sign-in…');
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      console.warn('AUREN sign-in failed:', error?.code || error);
      say(userError(error));
    } finally {
      button.disabled = false;
    }
  });
  logout?.addEventListener('click', async () => {
    // Reload on sign-out to prevent old account's in-memory data lingering.
    try { await signOut(auth); location.reload(); }
    catch { alert('Sign out failed. Please try again.'); }
  });
  onAuthStateChanged(auth, async user => {
    if (!user) { lock(); say('Sign in to continue. Your local data will be kept.'); return; }
    if (accountCard) accountCard.hidden = false;
    if (accountEmail) accountEmail.textContent = user.email || 'Signed in';
    unlock();
    if (!appLoaded) {
      appLoaded = true;
      try { await import('./app.js?v=2.8.6'); }
      catch (err) { console.error('AUREN app failed to load:', err); say('The assistant could not load. Refresh the page.'); lock(); }
    }
  }, error => {console.error('Firebase authentication error:', error); say('Unable to check your login. Refresh the page.');});
} catch (error) {
  console.error('AUREN Firebase initialization failed:', error);
  say('Login could not initialize. Check your connection and Firebase setup.');
}
