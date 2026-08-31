// PIN + optional platform-authenticator (Face/Touch ID) app-lock. Fully local —
// WebAuthn is used here without any relying-party server: a credential is
// created once and a later assertion is trusted purely because the browser/OS
// only resolves navigator.credentials.get() after the on-device biometric
// check passes. (A remote-facing app would additionally verify the assertion
// signature server-side; there's no server here, so that step is skipped by
// design — the OS-level gate is the actual security boundary being relied on.)

const PBKDF2_ITERATIONS = 120000;

async function deriveHash(pin, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function getLockRecord(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("lock", "readonly");
    const req = tx.objectStore("lock").get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function putLockRecord(db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("lock", "readwrite");
    tx.objectStore("lock").put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function isPinSet(db) {
  return !!(await getLockRecord(db, "pin"));
}

export async function setPin(db, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(pin, salt);
  await putLockRecord(db, { id: "pin", salt: bufToB64(salt), hash: bufToB64(hash) });
}

export async function verifyPin(db, pin) {
  const record = await getLockRecord(db, "pin");
  if (!record) return false;
  const hash = await deriveHash(pin, b64ToBuf(record.salt));
  return bufToB64(hash) === record.hash;
}

// --- Optional PIN-recovery contact (verified via js/recovery.js) ---

export async function setRecoveryContact(db, contact) {
  const existing = (await getLockRecord(db, "recovery")) || {};
  await putLockRecord(db, {
    id: "recovery",
    phone: contact.phone ?? existing.phone ?? null,
    email: contact.email ?? existing.email ?? null,
  });
}

export async function getRecoveryContact(db) {
  return (await getLockRecord(db, "recovery")) ?? null;
}

// --- Optional platform-authenticator (Face/Touch ID) unlock ---

export async function platformAuthAvailable() {
  return !!(window.PublicKeyCredential &&
    (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()));
}

export async function platformAuthRegistered(db) {
  return !!(await getLockRecord(db, "webauthn"));
}

export async function registerPlatformAuth(db) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Offrs' Pers Files" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "device-user", displayName: "Device" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  });
  await putLockRecord(db, { id: "webauthn", credentialId: bufToB64(credential.rawId) });
}

export async function unlockWithPlatformAuth(db) {
  const record = await getLockRecord(db, "webauthn");
  if (!record) return false;
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: b64ToBuf(record.credentialId), type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    return false; // user cancelled, failed verification, or no matching authenticator
  }
}
