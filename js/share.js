// Decrypt-then-open/share, shared by the flat category view (app.js) and the
// folder browser (folder.js). Share uses the Web Share API (Level 2, file
// sharing) where available — this hands the file straight to WhatsApp/etc via
// the OS share sheet; unsupported browsers fall back to opening it in a new
// tab so the user can save/share manually from there.

import { decryptBytes } from "./crypto.js";
import { mimeForFileType, filenameForDocument } from "./filetype.js";

// Object URLs from decrypted files live only in memory, but nothing ever
// revoked them (Android-side equivalent: OffrsApp's cache-sweep) — repeated
// Open taps just piled up blob URLs for the rest of the page's life. Track
// the one most recently opened and revoke it before minting the next, plus
// on unload; the just-opened tab has already loaded its copy by then.
let lastObjectUrl = null;

/**
 * Points an already-open tab/window at the decrypted file. Deliberately
 * takes a pre-opened window handle instead of calling window.open() itself
 * here — a real bug this fixes: window.open() called AFTER an await (the
 * decrypt) has no reliable user-gesture token left by the time it runs, so
 * browsers' popup blockers silently swallow it. Tapping a document did
 * nothing at all on real phones because of exactly this. Opening the blank
 * tab synchronously in the click handler, before any await, and only
 * redirecting it here once the file is ready keeps it tied to the tap.
 */
function showInTab(file, targetWindow) {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = URL.createObjectURL(file);
  if (targetWindow && !targetWindow.closed) targetWindow.location.href = lastObjectUrl;
  else window.open(lastObjectUrl, "_blank"); // targetWindow got blocked/closed too — last-resort attempt
}
window.addEventListener("beforeunload", () => {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
});

async function decryptToFile(fileKey, doc) {
  const plainBuffer = await decryptBytes(fileKey, doc.iv, doc.ciphertext);
  return new File([plainBuffer], filenameForDocument(doc), { type: mimeForFileType(doc.fileType) });
}

export async function openDocument(fileKey, doc) {
  const newTab = window.open("", "_blank"); // must be the first thing that happens — see showInTab
  const file = await decryptToFile(fileKey, doc);
  showInTab(file, newTab);
}

export async function shareDocument(fileKey, doc) {
  const newTab = window.open("", "_blank"); // reserved as a fallback tab in case Web Share isn't available; closed unused otherwise
  const file = await decryptToFile(fileKey, doc);

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    newTab?.close();
    try {
      await navigator.share({ files: [file], title: doc.title });
    } catch {
      // user cancelled the OS share sheet — nothing else to do
    }
    return;
  }

  // No Web Share (file) support here — open it so the user can save/share manually.
  showInTab(file, newTab);
}
