// Mirrors android's FileTypeUtil — same enum values: PDF | DOCX | JPEG | PNG | OTHER.
export function fileTypeFromFile(file) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type;

  if (ext === "pdf" || mime === "application/pdf") return "PDF";
  if (
    ext === "doc" || ext === "docx" ||
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "DOCX";
  if (ext === "jpg" || ext === "jpeg" || mime === "image/jpeg") return "JPEG";
  if (ext === "png" || mime === "image/png") return "PNG";
  return "OTHER";
}

export function extensionForFileType(fileType) {
  switch (fileType) {
    case "PDF": return "pdf";
    case "JPEG": return "jpg";
    case "PNG": return "png";
    case "DOCX": return "docx";
    default: return "";
  }
}

/** Doc title + correct extension, so the receiving app (WhatsApp, a viewer, ...) recognizes the file type. */
export function filenameForDocument(doc) {
  const ext = extensionForFileType(doc.fileType);
  if (!ext) return doc.title;
  return doc.title.toLowerCase().endsWith(`.${ext}`) ? doc.title : `${doc.title}.${ext}`;
}

export function mimeForFileType(fileType) {
  switch (fileType) {
    case "PDF": return "application/pdf";
    case "JPEG": return "image/jpeg";
    case "PNG": return "image/png";
    case "DOCX": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return "application/octet-stream";
  }
}
