
 // AUREN v2.9.0 — Google login and automatic cloud synchronization.
 // Firebase web identifiers are public; do not place admin credentials here.
 import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
 import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
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
 let appLoaded = false;
 let cloudMountedFor = null;

 function say(message) { if (status) status.textContent = message; }
 function unlock() { if (gate) gate.hidden = true; document.body.classList.remove('auren-auth-locked'); }
 function lock() {
   document.body.classList.add('auren-auth-locked');
   if (gate) gate.hidden = false;
   if (accountCard) accountCard.hidden = true;
 }
 function userError(error) {
   const code = String(error?.code || '');
   if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return 'Sign-in was cancelled.';
   if (code.includes('unauthorized-domain')) return 'Add darnellcarter12345-lgtm.github.io in Firebase Authorized domains.';
   if (code.includes('popup-blocked')) return 'Allow the Google sign-in popup in Safari, then try again.';
   if (code.includes('api-key-not-valid')) return 'Firebase rejected the web API key. Check Firebase Project Settings.';
   return 'Google sign-in could not complete. Check your connection and Firebase Authentication settings.';
 }

 try {
   const app = initializeApp(firebaseConfig);
   const auth = getAuth(app);
   await setPersistence(auth, browserLocalPersistence);
   button?.addEventListener('click', async () => {
     button.disabled = true; say('Opening Google sign-in…');
     try { await signInWithPopup(auth, new GoogleAuthProvider()); }
     catch (error) { console.warn('AUREN sign-in failed:', error); say(userError(error)); }
     finally { button.disabled = false; }
   });
   logout?.addEventListener('click', async () => {
     try { await signOut(auth); location.reload(); }
     catch { alert('Sign out failed. Please try again.'); }
   });
   onAuthStateChanged(auth, async user => {
     if (!user) { lock(); say('Sign in to continue. Your device data is kept.'); return; }
     if (accountCard) accountCard.hidden = false;
     if (accountEmail) accountEmail.textContent = user.email || 'Signed in';
     unlock();
     if (!appLoaded) {
       appLoaded = true;
       try { await import('./app.js?v=2.8.6'); }
       catch (error) { console.error('AUREN failed to load:', error); say('AUREN could not load. Refresh the page.'); lock(); return; }
     }
     if (cloudMountedFor !== user.uid) {
       cloudMountedFor = user.uid;
       mountCloudTransfer(app, user, accountCard);
     }
   }, error => { console.error('Firebase auth check failed:', error); say('Could not check your login. Refresh.'); });
 } catch (error) {
   console.error('Firebase initialization failed:', error);
   say('Login could not initialize. Check the Firebase configuration.');
 }
