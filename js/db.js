// IndexedDB layer — mirrors the Android Room schema (see /android .../data/model).
// Object stores: categories, folders, documents (file bytes stored encrypted,
// see js/crypto.js), keys (the non-extractable CryptoKey used to encrypt files).
//
// Schema:
//   categories: { id, key, displayName, isUserAdded, sortOrder }
//   folders:    { id, categoryId, parentFolderId, name, meta }         // meta = plain object, category-specific fields
//   documents:  { id, categoryId, folderId, title, iv, ciphertext, fileType,
//                 uploadDate, customFields, tags[], notes, ocrText }
//                 ocrText: extracted on-device from JPEG/PNG uploads — see js/ocr.js;
//                 undefined for PDF/DOCX/OTHER and for images OCR found no text in.
//   keys:       { id: "fileKey", key: CryptoKey }
//   lock:       { id: "pin", salt, hash } and/or { id: "webauthn", credentialId } — see js/lock.js
//
// Maps directly to Android's FileType enum: PDF | DOCX | JPEG | PNG | OTHER.

const DB_NAME = "offrs_pers_files";
const DB_VERSION = 5;

const BUILT_IN_CATEGORIES = [
  { key: "coro", displayName: "CORO", flat: true },
  { key: "ipft", displayName: "IPFT Docus", flat: false },       // auto Year -> 1st/2nd Bi-Annual
  { key: "ret", displayName: "RET Docus", flat: false },          // auto Year
  { key: "course_cadre", displayName: "Course/Cadre", flat: false }, // user-created folder per course
  { key: "jolshiri", displayName: "Jolshiri Docus", flat: true },
  { key: "misc", displayName: "Misc Docus", flat: true },         // flat + tags (Marriage, Driving License, ...)
  { key: "fin_banking", displayName: "Fin and Banking", flat: false }, // fixed sub-folders — see folder.js's Fin and Banking routing
  { key: "certificates", displayName: "Certificates", flat: true },
  { key: "resale_item_voucher", displayName: "Resale to Item Voucher", flat: true },
  { key: "tada_bill", displayName: "TA/DA Bill Docu", flat: true },
  { key: "salary_adjustment", displayName: "Salary Adjustment Docu", flat: true },
  { key: "yrly_diff_fees", displayName: "Yrly Diff Fees", flat: false },       // fixed "Family Sy Docu" + user can add more
  { key: "driving_license_docu", displayName: "Driving License Docu", flat: false }, // Mil/Civil, each with an expiry_date field
  { key: "imp_med_docu", displayName: "Imp Med Docu", flat: true },
  { key: "imp_cards", displayName: "Imp Cards", flat: false },                // NID/Mil ID/Driving License/... each Front-or-Back only
  { key: "parents_docus", displayName: "Parents Docus", flat: true },
  { key: "spouse_docus", displayName: "Spouse Docus", flat: true },
  { key: "updt_bafz_2043", displayName: "Updt BAFZ 2043", flat: true },
  { key: "updt_bio_data", displayName: "Updt Bio Data", flat: true },
];

// "Keep Track of.." fixed ledger groups + trackers — mirrors android's
// TrackerModels.kt's BUILT_IN_TRACKER_ITEMS exactly.
const BUILT_IN_TRACKER_ITEMS = [
  ["diff_alce", "Outfit Allce"], ["diff_alce", "Staff Allce (Adjt/QM)"], ["diff_alce", "Comd Allce (OC/CO)"],
  ["diff_alce", "Boishakhi Allce"], ["diff_alce", "Cdo Allce"], ["diff_alce", "Parachute Allce"],
  ["diff_alce", "Scuba Allce"], ["diff_alce", "Kit Allce"], ["diff_alce", "Tailor Allce"],
  ["diff_alce", "Clean Svc Allce"], ["diff_alce", "Instr Allce"],
  ["misc_track", "House Rent"], ["misc_track", "Milk Coupn"], ["misc_track", "Ration"],
  ["misc_track", "Pending Bill/ TADA"], ["misc_track", "Mess Bill"], ["misc_track", "Fd Mess Bill"],
  ["misc_track", "Other Bills (Credit Card/ Loan)"],
];

// Fixed Pers Docu checklist, in English (using JSSDM-authorized abbreviations
// — Allce/Svc/rk/P Lve/Docu, see /JSSDM 2022-405-485.pdf Annex A) — mirrors
// android's BUILT_IN_CHECKLIST_ITEMS exactly. cadence: "bi_annual" | "annual"
// | "monthly" | "once" (never re-prompts once ticked).
const BUILT_IN_CHECKLIST_ITEMS = [
  ["My all IPFT Div Orders are updt and saved.", "bi_annual"],
  ["My all RET Div Orders are updt and saved.", "annual"],
  ["My all Course Result CORO+ Div Orders (incl BAO) are updt and saved.", "bi_annual"],
  ["My all Appointment CORO are updt and saved.", "annual"],
  ["My PE Pass CORO is updt and saved.", "annual"],
  ["My all rk CORO are updt and saved.", "annual"],
  ["My all Medal CORO are updt and saved.", "annual"],
  ["My Clean Svc Allce CORO is updt and saved.", "annual"],
  ["My Hill Allce CORO is updt and saved.", "annual"],
  ["My P Lve CORO is updt and saved.", "annual"],
  ["My Adv Map Reading + Commission CORO (from BMA) is updt and saved.", "once"],
  ["My Marriage CORO is updt and saved.", "once"],
  ["CORO of any extra allce applicable for me is updt and saved.", "monthly"],
  ["My all Pay Slips are updt and saved.", "monthly"],
  ["My all Income Tax Docus are updt and saved.", "annual"],
];

// Old Bengali seed text, retired in favour of the English list above —
// seedTrackingData deletes any row still holding this exact text so it
// doesn't linger duplicated alongside the new English default that replaces
// it. Any row the user renamed away from the original text is untouched.
const RETIRED_BENGALI_CHECKLIST_TEXT = [
  "আমার সকল আইপিএফটি ডিভ অর্ডার।",
  "আমার সকল আরইটি ডিভ অর্ডার।",
  "আমার সকল কোর্স রেজাল্ট এর CORO+ ডিভ অর্ডার। (BAO সহ)",
  "আমার সকল দায়িত্ব প্রাপ্ত অ্যাপয়েনমেন্ট এর CORO।",
  "আমার পিই(PE) পাশ এর CORO।",
  "আমার সকল rk এর CORO।",
  "আমার সকল পদক এর CORO।",
  "আমার ক্লিন সার্ভিস allowance এর CORO।",
  "আমার পাহাড়ি ভাতার CORO।",
  "আমার পিলিভ এর CORO।",
  "Adv Map Reading + Commission CORO (from BMA)।",
  "বিয়ের CORO।",
  "Extra কোনো ভাতা যদি আমার জন্য applicable হয় ঐটার CORO।",
  "আমার সকল pay slip।",
  "আমার সকল income tax।",
];

// English checklist, separate from the Bengali one above — same mechanics,
// its own "+ Add" section. Mirrors android's GENERAL_CHECKLIST_ITEMS.
const GENERAL_CHECKLIST_ITEMS = [
  ["My all CORO Docus are updt and saved", "annual"],
];

// CORO/Misc sub-folder defaults — used to be a flat category + an editable
// title-chip picker (title_options store below), now real sub-folders
// (folder.js's openExtensibleFixed), same pattern as Course/Cadre. Mirrors
// android's CORO_DEFAULT_TITLE_OPTIONS/MISC_DEFAULT_TITLE_OPTIONS.
export const CORO_DEFAULT_TITLE_OPTIONS = [
  "Commission CORO", "Posting CORO", "Map Reading Exam CORO", "P Lve CORO", "Appt CORO",
  "PE Lt to Capt CORO", "PE Capt to Maj CORO", "Spl Family Pension CORO", "NOC CORO",
  "Atts and Dets", "Medals CORO", "Course/ Cadres CORO", "Temp Rk CORO", "Perm Rk CORO",
  "Mov CORO", "Cleans Svc Alce CORO", "Marriage CORO", "Promotion", "R Lve CORO",
];
export const MISC_DEFAULT_TITLE_OPTIONS = ["Marriage Cert", "Nationality Cert", "Birth Cert", "HSC", "SSC", "MIST/ BUP", "DOs"];

// Course/Cadre's default course folders — same idea, but folders (see
// getOrCreateNamedFolder), not title_options rows. Mirrors android's
// COURSE_CADRE_DEFAULT_COURSES.
export const COURSE_CADRE_DEFAULT_COURSES = [
  "BPC 28", "PCAT", "OBC 16 (Tac Leg)", "OBC 16 (Won Leg)", "OWC 103", "ALSC 8", "BCC 72", "JCSC 77",
];

export const YEAR_SEED_START = 2020;

export function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains("categories")) {
        const categories = db.createObjectStore("categories", { keyPath: "id", autoIncrement: true });
        categories.createIndex("key", "key", { unique: true });
      }

      if (!db.objectStoreNames.contains("folders")) {
        const folders = db.createObjectStore("folders", { keyPath: "id", autoIncrement: true });
        folders.createIndex("categoryId", "categoryId");
        folders.createIndex("parentFolderId", "parentFolderId");
      }

      if (!db.objectStoreNames.contains("documents")) {
        const documents = db.createObjectStore("documents", { keyPath: "id", autoIncrement: true });
        documents.createIndex("categoryId", "categoryId");
        documents.createIndex("folderId", "folderId");
        documents.createIndex("title", "title");
        documents.createIndex("tags", "tags", { multiEntry: true });
      }

      if (!db.objectStoreNames.contains("keys")) {
        db.createObjectStore("keys", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("lock")) {
        db.createObjectStore("lock", { keyPath: "id" }); // "pin" and/or "webauthn" records — see js/lock.js
      }

      // "Keep Track of.." ledger + Pers Docu checklist — see js/track.js.
      if (!db.objectStoreNames.contains("trackerItems")) {
        const trackerItems = db.createObjectStore("trackerItems", { keyPath: "id", autoIncrement: true });
        trackerItems.createIndex("groupKey", "groupKey");
      }
      if (!db.objectStoreNames.contains("trackerEntries")) {
        const trackerEntries = db.createObjectStore("trackerEntries", { keyPath: "id", autoIncrement: true });
        trackerEntries.createIndex("trackerItemId", "trackerItemId");
      }
      if (!db.objectStoreNames.contains("checklistItems")) {
        db.createObjectStore("checklistItems", { keyPath: "id", autoIncrement: true });
      }

      // CORO/Misc's editable common-title presets — see js/docs-panel.js's "Manage" dialog.
      if (!db.objectStoreNames.contains("titleOptions")) {
        const titleOptions = db.createObjectStore("titleOptions", { keyPath: "id", autoIncrement: true });
        titleOptions.createIndex("categoryKey", "categoryKey");
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Seeds the built-in categories on first run — and stays idempotent by `key`
// (not just "store is empty") on every run after, so an existing install
// picks up new defaults added in a later app update instead of being stuck
// with only whatever existed when it was first opened. Real bug this fixes:
// the category/tracker/checklist/title-option seed lists all grew across
// several updates this project went through — a browser that opened the app
// early only ever got the original count===0 gate's one-time snapshot.
// User-added categories (9+) are inserted the same way at runtime with isUserAdded: true.
export async function seedBuiltInCategories(db) {
  const tx = db.transaction("categories", "readwrite");
  const store = tx.objectStore("categories");
  const existingKeys = new Set((await new Promise((res, rej) => {
    const r = store.getAll();
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  })).map((c) => c.key));
  const missing = BUILT_IN_CATEGORIES.filter((cat) => !existingKeys.has(cat.key));
  missing.forEach((cat, i) => {
    store.add({ ...cat, isUserAdded: false, sortOrder: existingKeys.size + i });
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Seeds the fixed tracker items and checklist items — mirrors seedBuiltInCategories' idempotent-by-natural-key approach. */
export async function seedTrackingData(db) {
  const trackerTx = db.transaction("trackerItems", "readwrite");
  const trackerStore = trackerTx.objectStore("trackerItems");
  const existingTrackerNames = new Set((await new Promise((res) => { const r = trackerStore.getAll(); r.onsuccess = () => res(r.result); })).map((t) => t.name));
  const missingTrackers = BUILT_IN_TRACKER_ITEMS.filter(([, name]) => !existingTrackerNames.has(name));
  missingTrackers.forEach(([groupKey, name], i) => {
    trackerStore.add({ groupKey, name, isUserAdded: false, reminderCadence: "monthly", sortOrder: existingTrackerNames.size + i, createdAt: Date.now() });
  });
  await new Promise((resolve, reject) => { trackerTx.oncomplete = resolve; trackerTx.onerror = () => reject(trackerTx.error); });

  const checklistTx = db.transaction("checklistItems", "readwrite");
  const checklistStore = checklistTx.objectStore("checklistItems");
  const existingChecklistRows = await new Promise((res) => { const r = checklistStore.getAll(); r.onsuccess = () => res(r.result); });
  // Retire the old Bengali seed rows in favour of the English replacement —
  // delete-by-exact-text, so a row the user renamed away from the original
  // text (no longer an exact match) is left untouched.
  existingChecklistRows
    .filter((row) => RETIRED_BENGALI_CHECKLIST_TEXT.includes(row.textBn))
    .forEach((row) => checklistStore.delete(row.id));
  const existingChecklistTexts = new Set(
    existingChecklistRows.map((c) => c.textBn).filter((text) => !RETIRED_BENGALI_CHECKLIST_TEXT.includes(text))
  );
  let checklistSortOrder = existingChecklistTexts.size;
  BUILT_IN_CHECKLIST_ITEMS.filter(([textBn]) => !existingChecklistTexts.has(textBn)).forEach(([textBn, cadence]) => {
    checklistStore.add({ textBn, cadence, tickedAt: null, sortOrder: checklistSortOrder++, section: "pers_docu" });
  });
  GENERAL_CHECKLIST_ITEMS.filter(([textBn]) => !existingChecklistTexts.has(textBn)).forEach(([textBn, cadence]) => {
    checklistStore.add({ textBn, cadence, tickedAt: null, sortOrder: checklistSortOrder++, section: "general" });
  });
  await new Promise((resolve, reject) => { checklistTx.oncomplete = resolve; checklistTx.onerror = () => reject(checklistTx.error); });

  // titleOptions store is unused now that CORO/Misc are real sub-folders
  // instead of a flat category + chip picker — nothing left to seed there.
}

/**
 * CORO and Misc moved from a flat category + title-chip picker to real
 * sub-folders (matching Course/Cadre) — re-files any already-saved flat
 * document (folderId null) into a folder named after its own title, so
 * nothing drops out of Browse. A document's title was exactly the chip
 * label it was saved under, so this maps 1:1 onto the same name the new
 * folder list is seeded with. Idempotent — safe to run on every load, same
 * as the checklist-text cleanup above (IndexedDB has no formal migration
 * mechanism, so this is how a data-shape change gets applied here).
 */
export async function migrateFlatCoroMiscToFolders(db) {
  const categories = await getAllCategories(db);
  for (const key of ["coro", "misc"]) {
    const category = categories.find((c) => c.key === key);
    if (!category) continue;
    const flatDocs = await getDocumentsByCategoryFlat(db, category.id);
    if (flatDocs.length === 0) continue;
    const folderIdByTitle = new Map();
    for (const doc of flatDocs) {
      let folderId = folderIdByTitle.get(doc.title);
      if (folderId == null) {
        const folder = await getOrCreateNamedFolder(db, category.id, null, doc.title);
        folderId = folder.id;
        folderIdByTitle.set(doc.title, folderId);
      }
      await new Promise((resolve, reject) => {
        const tx = db.transaction("documents", "readwrite");
        const store = tx.objectStore("documents");
        const req = store.get(doc.id);
        req.onsuccess = () => {
          const record = req.result;
          record.folderId = folderId;
          store.put(record);
        };
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  }
}

/** Turns a user-typed category name into a DB key — lowercase, non-alphanumerics collapsed to underscores, de-duped against existing keys. Mirrors android's slugifyCategoryName exactly. */
export function slugifyCategoryName(name, existingKeys) {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "category";
  if (!existingKeys.includes(base)) return base;
  let counter = 2;
  while (existingKeys.includes(`${base}_${counter}`)) counter++;
  return `${base}_${counter}`;
}

/** category = { key, displayName, isUserAdded, sortOrder } — used both for user-added categories (future) and backup import. */
export function createCategory(db, category) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("categories", "readwrite");
    const req = tx.objectStore("categories").add(category);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** { [categoryId]: count } across all documents — for the Home stat row / category card subtitles. */
export function getDocCountsByCategory(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readonly");
    const req = tx.objectStore("documents").getAll();
    req.onsuccess = () => {
      const counts = {};
      for (const doc of req.result) counts[doc.categoryId] = (counts[doc.categoryId] ?? 0) + 1;
      resolve(counts);
    };
    req.onerror = () => reject(req.error);
  });
}

export function getAllCategories(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("categories", "readonly");
    const req = tx.objectStore("categories").getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.sortOrder - b.sortOrder));
    req.onerror = () => reject(req.error);
  });
}

/** doc = { categoryId, folderId, title, iv, ciphertext, fileType, customFields, tags, notes } */
export function addDocument(db, doc) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readwrite");
    const req = tx.objectStore("documents").add({
      ...doc,
      uploadDate: doc.uploadDate ?? Date.now(), // preserved on backup import, defaulted on fresh upload
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Every document, across every category/folder, newest first — the Career Timeline tab. */
export function getAllDocumentsSorted(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readonly");
    const req = tx.objectStore("documents").getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.uploadDate - a.uploadDate));
    req.onerror = () => reject(req.error);
  });
}

export function getDocumentsByCategoryFlat(db, categoryId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readonly");
    const req = tx.objectStore("documents").index("categoryId").getAll(categoryId);
    req.onsuccess = () => resolve(req.result.filter((d) => d.folderId == null).sort((a, b) => b.uploadDate - a.uploadDate));
    req.onerror = () => reject(req.error);
  });
}

// ---------- Folders (IPFT Year/Bi-Annual, RET Year, Course/Cadre course folders) ----------

export function getChildFolders(db, categoryId, parentFolderId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("folders", "readonly");
    const req = tx.objectStore("folders").index("categoryId").getAll(categoryId);
    req.onsuccess = () => resolve(
      req.result.filter((f) => (f.parentFolderId ?? null) === (parentFolderId ?? null))
    );
    req.onerror = () => reject(req.error);
  });
}

export function createFolder(db, categoryId, parentFolderId, name, meta = {}) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("folders", "readwrite");
    const record = { categoryId, parentFolderId: parentFolderId ?? null, name, meta };
    const req = tx.objectStore("folders").add(record);
    req.onsuccess = () => resolve({ ...record, id: req.result });
    req.onerror = () => reject(req.error);
  });
}

/** Finds a folder by name under this parent, creating it if it doesn't exist yet — used for auto Year / Bi-Annual folders. */
export async function getOrCreateNamedFolder(db, categoryId, parentFolderId, name, meta = {}) {
  const children = await getChildFolders(db, categoryId, parentFolderId);
  const existing = children.find((f) => f.name === name);
  return existing ?? createFolder(db, categoryId, parentFolderId, name, meta);
}

/** Renamable/deletable defaults (Course/Cadre courses, RET/IPFT years) — "these are for ease of guiding them", not fixed. */
export function renameFolder(db, folder, newName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("folders", "readwrite");
    const req = tx.objectStore("folders").put({ ...folder, name: newName });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Deletes only the folder itself — documents inside stay on disk and stay findable via Search/Timeline, they just lose this folder's browse path (see the confirmation dialog in folder.js). */
export function deleteFolder(db, folder) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("folders", "readwrite");
    tx.objectStore("folders").delete(folder.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Used before deleting a folder — warns the user if it still holds documents. */
export function countDocumentsInFolder(db, folderId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readonly");
    const req = tx.objectStore("documents").index("folderId").count(folderId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** No single "all folders" store scan by category — walks each category's tree instead. Used by backup export and the Timeline's date resolution. */
export async function getAllFolders(db, categories) {
  const all = [];
  async function walk(categoryId, parentFolderId) {
    const children = await getChildFolders(db, categoryId, parentFolderId);
    for (const f of children) {
      all.push(f);
      await walk(categoryId, f.id);
    }
  }
  for (const c of categories) await walk(c.id, null);
  return all;
}

export function getDocumentsByFolder(db, folderId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readonly");
    const req = tx.objectStore("documents").index("folderId").getAll(folderId);
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.uploadDate - a.uploadDate));
    req.onerror = () => reject(req.error);
  });
}

/** Full-scan search across title, tags, and every customFields value (CORO number, cert issuer, doc sub-type, ...) — mirrors android's DocumentDao.search. IndexedDB has no LIKE/text index, and this app's realistic data volume (one person's career documents) makes a full scan fine. */
export function searchDocuments(db, query) {
  const needle = query.trim().toLowerCase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readonly");
    const req = tx.objectStore("documents").getAll();
    req.onsuccess = () => {
      const results = req.result
        .filter((doc) => {
          const haystack = [doc.title, doc.ocrText, ...(doc.tags ?? []), ...Object.values(doc.customFields ?? {})]
            .filter(Boolean).join(" ").toLowerCase();
          return haystack.includes(needle);
        })
        .sort((a, b) => b.uploadDate - a.uploadDate);
      resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export function deleteDocument(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", "readwrite");
    tx.objectStore("documents").delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- "Keep Track of.." ledger ----------

export function getTrackerItems(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trackerItems", "readonly");
    const req = tx.objectStore("trackerItems").getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.sortOrder - b.sortOrder));
    req.onerror = () => reject(req.error);
  });
}

export function addCustomTracker(db, groupKey, name, sortOrder) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trackerItems", "readwrite");
    const req = tx.objectStore("trackerItems").add({ groupKey, name, isUserAdded: true, reminderCadence: "monthly", sortOrder, createdAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function setTrackerCadence(db, trackerItem, cadence) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trackerItems", "readwrite");
    const req = tx.objectStore("trackerItems").put({ ...trackerItem, reminderCadence: cadence });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function getTrackerEntries(db, trackerItemId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trackerEntries", "readonly");
    const req = tx.objectStore("trackerEntries").index("trackerItemId").getAll(trackerItemId);
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.dateEpoch - a.dateEpoch));
    req.onerror = () => reject(req.error);
  });
}

export function addTrackerEntry(db, entry) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trackerEntries", "readwrite");
    const req = tx.objectStore("trackerEntries").add(entry);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function deleteTrackerEntry(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trackerEntries", "readwrite");
    tx.objectStore("trackerEntries").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/** { [trackerItemId]: mostRecentDateEpoch } — used to compute each tracker's next-due reminder without loading every entry. */
export function getLastEntryDates(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trackerEntries", "readonly");
    const req = tx.objectStore("trackerEntries").getAll();
    req.onsuccess = () => {
      const last = {};
      for (const entry of req.result) {
        if (!(entry.trackerItemId in last) || entry.dateEpoch > last[entry.trackerItemId]) last[entry.trackerItemId] = entry.dateEpoch;
      }
      resolve(last);
    };
    req.onerror = () => reject(req.error);
  });
}

const CADENCE_DAYS = { monthly: 30, quarterly: 91, biannual: 182, annual: 365 };

/** Next-due epoch for a tracker's reminder badge — null means never (cadence "off"). Mirrors android's TrackerItem.nextDueEpoch. */
export function trackerNextDueEpoch(trackerItem, lastEntryEpoch) {
  const days = CADENCE_DAYS[trackerItem.reminderCadence];
  if (!days) return null;
  const base = lastEntryEpoch ?? trackerItem.createdAt ?? Date.now();
  return base + days * 24 * 60 * 60 * 1000;
}

// ---------- Pers Docu checklist ----------

export function getTitleOptions(db, categoryKey) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("titleOptions", "readonly");
    const req = tx.objectStore("titleOptions").index("categoryKey").getAll(categoryKey);
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.sortOrder - b.sortOrder));
    req.onerror = () => reject(req.error);
  });
}

export function addTitleOption(db, categoryKey, label, sortOrder) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("titleOptions", "readwrite");
    const req = tx.objectStore("titleOptions").add({ categoryKey, label, sortOrder });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function renameTitleOption(db, option, newLabel) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("titleOptions", "readwrite");
    const req = tx.objectStore("titleOptions").put({ ...option, label: newLabel });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function deleteTitleOption(db, option) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("titleOptions", "readwrite");
    tx.objectStore("titleOptions").delete(option.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function getChecklistItems(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checklistItems", "readonly");
    const req = tx.objectStore("checklistItems").getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.sortOrder - b.sortOrder));
    req.onerror = () => reject(req.error);
  });
}

export function setChecklistTicked(db, item, ticked) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checklistItems", "readwrite");
    const req = tx.objectStore("checklistItems").put({ ...item, tickedAt: ticked ? Date.now() : null });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function addChecklistItem(db, textBn, cadence, section, sortOrder) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checklistItems", "readwrite");
    const req = tx.objectStore("checklistItems").add({ textBn, cadence, section, tickedAt: null, sortOrder });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function deleteChecklistItem(db, item) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("checklistItems", "readwrite");
    tx.objectStore("checklistItems").delete(item.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

const CHECKLIST_CADENCE_DAYS = { monthly: 30, bi_annual: 182, annual: 365 };

/** Mirrors android's ChecklistItem.isDueForRecheck. */
export function checklistIsDue(item, nowEpoch) {
  if (item.cadence === "once") return item.tickedAt == null;
  if (item.tickedAt == null) return true;
  const days = CHECKLIST_CADENCE_DAYS[item.cadence] ?? 365;
  return nowEpoch - item.tickedAt >= days * 24 * 60 * 60 * 1000;
}
