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
function openObjectUrl(file) {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  lastObjectUrl = URL.createObjectURL(file);
  window.open(lastObjectUrl, "_blank");
}
window.addEventListener("beforeunload", () => {
  if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
});

async function decryptToFile(fileKey, doc) {
  const plainBuffer = await decryptBytes(fileKey, doc.iv, doc.ciphertext);
  return new File([plainBuffer], filenameForDocument(doc), { type: mimeForFileType(doc.fileType) });
}

export async function openDocument(fileKey, doc) {
  const file = await decryptToFile(fileKey, doc);
  openObjectUrl(file);
}

export async function shareDocument(fileKey, doc) {
  const file = await decryptToFile(fileKey, doc);

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: doc.title });
    } catch {
      // user cancelled the OS share sheet — nothing else to do
    }
    return;
  }

  // No Web Share (file) support here — open it so the user can save/share manually.
  openObjectUrl(file);
}
