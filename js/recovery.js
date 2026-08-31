// Firebase-backed PIN recovery: Phone OTP (SMS) via Firebase Phone Auth, and
// Email Link (passwordless) via Firebase's email-link sign-in — both used
// ONLY to prove the user still controls their registered phone/email. Not a
// real account system: the app itself has no login and stores no documents
// remotely. Uses the Firebase compat SDK (loaded via <script> in index.html)
// so this stays a plain ES module with no bundler needed.
//
// Note: Android uses Phone Auth only (no email recovery there) — Firebase's
// classic email-link-into-native-app flow relied on Dynamic Links, which
// Google shut down in 2025. On the web there's no such dependency — a
// sign-in link is just a normal URL back to this same page, so email
// recovery works cleanly here. See /SETUP_FIREBASE.md.

import { firebaseConfig } from "./firebase-config.js";

let auth;
let recaptchaVerifier;
let phoneConfirmationResult;

function ensureInit() {
  if (auth) return;
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
}

function getRecaptcha(containerId) {
  ensureInit();
  if (!recaptchaVerifier) {
    recaptchaVerifier = new firebase.auth.RecaptchaVerifier(containerId, { size: "invisible" }, auth);
  }
  return recaptchaVerifier;
}

export async function sendPhoneOtp(phoneNumber, recaptchaContainerId) {
  ensureInit();
  const verifier = getRecaptcha(recaptchaContainerId);
  phoneConfirmationResult = await auth.signInWithPhoneNumber(phoneNumber, verifier);
}

export async function verifyPhoneOtp(code) {
  if (!phoneConfirmationResult) throw new Error("No code was sent");
  await phoneConfirmationResult.confirm(code);
}

const PENDING_EMAIL_KEY = "offrs_recovery_pending_email";

export async function sendEmailRecoveryLink(email) {
  ensureInit();
  const actionCodeSettings = { url: window.location.href, handleCodeInApp: true };
  await auth.sendSignInLinkToEmail(email, actionCodeSettings);
  try { localStorage.setItem(PENDING_EMAIL_KEY, email); } catch { /* best-effort only */ }
}

export function isEmailRecoveryLink() {
  ensureInit();
  return auth.isSignInWithEmailLink(window.location.href);
}

/** Completes an email-link recovery arrived at via a fresh page load (user tapped the link in their inbox). Returns the email that was verified. */
export async function completeEmailRecoveryLink(emailIfKnown) {
  ensureInit();
  let email = emailIfKnown;
  if (!email) {
    try { email = localStorage.getItem(PENDING_EMAIL_KEY); } catch { /* ignore */ }
  }
  if (!email) throw new Error("Enter the email you used to request the reset");

  await auth.signInWithEmailLink(email, window.location.href);
  try { localStorage.removeItem(PENDING_EMAIL_KEY); } catch { /* ignore */ }
  window.history.replaceState({}, document.title, window.location.pathname); // drop the sign-in params from the URL bar
  return email;
}
