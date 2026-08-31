// Bundle Share (zip, any file type) and Print-ready Dossier (PDF, images only)
// — mirrors android's DocumentRepository.prepareBundleZip/prepareDossierPdf.
// Both decrypt the selected documents client-side and hand the result to the
// Web Share API (falling back to a download link where unsupported).

import { decryptBytes } from "./crypto.js";
import { mimeForFileType, filenameForDocument } from "./filetype.js";

async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch {
      // user cancelled — fall through to download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Zips the selected documents (any file type) into one archive — one WhatsApp/etc attachment instead of one-by-one. */
export async function shareBundleZip(fileKey, documents) {
  const zip = new JSZip();
  const usedNames = new Set();

  for (const doc of documents) {
    const plainBuffer = await decryptBytes(fileKey, doc.iv, doc.ciphertext);
    let name = filenameForDocument(doc);
    let counter = 1;
    while (usedNames.has(name)) {
      const dot = name.lastIndexOf(".");
      name = dot > 0 ? `${name.slice(0, dot)}_${counter}${name.slice(dot)}` : `${name}_${counter}`;
      counter++;
    }
    usedNames.add(name);
    zip.file(name, plainBuffer);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  await shareOrDownload(blob, `offrs-bundle-${Date.now()}.zip`);
}

/** Merges selected JPEG/PNG documents into one PDF, one image per A4 page — real PDFs already in hand aren't merged (no PDF-merge library), so this only accepts images; use Bundle Share (zip) for mixed selections. */
export async function shareDossierPdf(fileKey, imageDocuments) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 24;

  for (let i = 0; i < imageDocuments.length; i++) {
    const doc = imageDocuments[i];
    const plainBuffer = await decryptBytes(fileKey, doc.iv, doc.ciphertext);
    const blob = new Blob([plainBuffer], { type: mimeForFileType(doc.fileType) });
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const dims = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.width, height: img.height });
      img.onerror = reject;
      img.src = dataUrl;
    });

    if (i > 0) pdf.addPage();
    const maxWidth = pageWidth - margin * 2;
    const maxHeight = pageHeight - margin * 2;
    const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height);
    const drawWidth = dims.width * scale;
    const drawHeight = dims.height * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    const format = doc.fileType === "PNG" ? "PNG" : "JPEG";
    pdf.addImage(dataUrl, format, x, y, drawWidth, drawHeight);
  }

  const blob = pdf.output("blob");
  await shareOrDownload(blob, `offrs-dossier-${Date.now()}.pdf`);
}
