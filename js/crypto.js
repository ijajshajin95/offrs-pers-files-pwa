// AES-GCM encryption for file bytes at rest (mirrors android's EncryptedFileStorage).
// The key is generated non-extractable and stored directly as a CryptoKey object
// inside IndexedDB's "keys" store — modern browsers support structured-cloning
// CryptoKey objects, so the raw key material is never exposed to JS at all.
//
// TODO: once app-lock (PIN/WebAuthn) is built, wrap this key behind that unlock
// step instead of loading it unconditionally on app start.

export async function getOrCreateKey(db) {
  const existing = await new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readonly");
    const req = tx.objectStore("keys").get("fileKey");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (existing) return existing.key;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["encrypt", "decrypt"]
  );

  await new Promise((resolve, reject) => {
    const tx = db.transaction("keys", "readwrite");
    tx.objectStore("keys").put({ id: "fileKey", key });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  return key;
}

export async function encryptBytes(key, arrayBuffer) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, arrayBuffer);
  return { iv, ciphertext };
}

export async function decryptBytes(key, iv, ciphertext) {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
}
