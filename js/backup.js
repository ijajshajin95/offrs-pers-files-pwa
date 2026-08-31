// Whole-app backup/restore — the only safety net given there's no cloud sync.
// Matches android's BackupManager.kt JSON shape exactly (same field names,
// same AES-GCM/PBKDF2 parameters: 12-byte IV, 128-bit tag, PBKDF2-HMAC-SHA256,
// 120000 iterations) so a backup exported on one platform can, in principle,
// be imported on the other. Not a real .zip — a single JSON file with
// document bytes embedded as base64 ciphertext; simpler and dependency-free,
// at the cost of a larger file than a real archive would produce.

import { decryptBytes, encryptBytes } from "./crypto.js";
import { getAllCategories, getAllFolders, createCategory, createFolder, addDocument } from "./db.js";

const PBKDF2_ITERATIONS = 120000;
const FORMAT_VERSION = 1;

function bufToB64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

async function deriveKey(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function getAllDocuments(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readonly");
    const req = tx.objectStore("documents").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function exportBackup(db, fileKey, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);

  const categories = await getAllCategories(db);
  const folders = await getAllFolders(db, categories);
  const documents = await getAllDocuments(db);

  const docsOut = [];
  for (const doc of documents) {
    const plainBuffer = await decryptBytes(fileKey, doc.iv, doc.ciphertext);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plainBuffer);
    docsOut.push({
      id: doc.id,
      categoryId: doc.categoryId,
      folderId: doc.folderId ?? null,
      title: doc.title,
      fileType: doc.fileType,
      uploadDateEpoch: doc.uploadDate,
      customFieldsJson: JSON.stringify(doc.customFields ?? {}),
      tags: doc.tags ?? [],
      notes: doc.notes ?? null,
      ocrText: doc.ocrText ?? null,
      iv: bufToB64(iv),
      data: bufToB64(ciphertext),
    });
  }

  const root = {
    app: "Offrs' Pers Files",
    formatVersion: FORMAT_VERSION,
    exportedAt: Date.now(),
    kdf: { algorithm: "PBKDF2WithHmacSHA256", iterations: PBKDF2_ITERATIONS, salt: bufToB64(salt) },
    categories: categories.map((c) => ({
      id: c.id, key: c.key, displayName: c.displayName, isUserAdded: !!c.isUserAdded, sortOrder: c.sortOrder,
    })),
    folders: folders.map((f) => ({
      id: f.id, categoryId: f.categoryId, parentFolderId: f.parentFolderId ?? null,
      name: f.name, metaJson: JSON.stringify(f.meta ?? {}),
    })),
    documents: docsOut,
  };

  return JSON.stringify(root);
}

/** Returns the number of documents imported. Existing categories are matched by key (not duplicated); folders and documents are always added as new rows. */
export async function importBackup(db, fileKey, password, jsonText) {
  const root = JSON.parse(jsonText);
  const salt = new Uint8Array(b64ToBuf(root.kdf.salt));
  const key = await deriveKey(password, salt);

  const existingCategories = await getAllCategories(db);
  const categoryIdMap = {};
  for (const c of root.categories) {
    const existing = existingCategories.find((x) => x.key === c.key);
    const newId = existing
      ? existing.id
      : await createCategory(db, {
        key: c.key, displayName: c.displayName, isUserAdded: !!c.isUserAdded, sortOrder: c.sortOrder ?? 0,
      });
    categoryIdMap[c.id] = newId;
  }

  // Folders can nest (IPFT: Year -> Bi-Annual), so a parent must exist before
  // its child is created. This app's folders are shallow (depth 2 max), so a
  // few retry passes always resolves the whole set.
  const folderIdMap = {};
  let pending = [...root.folders];
  let guard = 0;
  while (pending.length && guard < 10) {
    guard++;
    const stillPending = [];
    for (const f of pending) {
      let newParentId = null;
      if (f.parentFolderId != null) {
        if (!(f.parentFolderId in folderIdMap)) { stillPending.push(f); continue; }
        newParentId = folderIdMap[f.parentFolderId];
      }
      const newCategoryId = categoryIdMap[f.categoryId];
      if (newCategoryId === undefined) continue;
      const meta = JSON.parse(f.metaJson || "{}");
      const created = await createFolder(db, newCategoryId, newParentId, f.name, meta);
      folderIdMap[f.id] = created.id;
    }
    pending = stillPending;
  }

  let imported = 0;
  for (const d of root.documents) {
    const newCategoryId = categoryIdMap[d.categoryId];
    if (newCategoryId === undefined) continue;
    const newFolderId = d.folderId == null ? null : folderIdMap[d.folderId];

    const ciphertext = b64ToBuf(d.data);
    const iv = new Uint8Array(b64ToBuf(d.iv));
    const plainBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);

    // Re-encrypt under this device's own fileKey — imported documents are
    // stored exactly like freshly-uploaded ones from here on.
    const local = await encryptBytes(fileKey, plainBuffer);

    await addDocument(db, {
      categoryId: newCategoryId,
      folderId: newFolderId ?? null,
      title: d.title,
      iv: local.iv,
      ciphertext: local.ciphertext,
      fileType: d.fileType,
      customFields: JSON.parse(d.customFieldsJson || "{}"),
      tags: d.tags ?? [],
      notes: d.notes ?? null,
      ocrText: d.ocrText ?? undefined,
      uploadDate: d.uploadDateEpoch,
    });
    imported++;
  }

  return imported;
}
