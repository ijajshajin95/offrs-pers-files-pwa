// Shared upload-form + document-list renderer — mirrors android's
// DocumentsPanel.kt composable. Used both for flat categories (folderId null)
// and inside folders (IPFT/RET/Course-Cadre/...), rendering into whatever
// `container` element the caller gives it.
//
// options.titleOptions: chip picker replacing the free-text Title field (e.g.
//   IPFT: Div Order/Result/Related Corres/Exemtion Ltr/Others) — "Others"
//   reveals a text field for a custom title.
// options.extraFields: [{key, label, isDate}] extra inputs -> customFields[key]
//   (CORO, Certificates, Driving License expiry)
// options.notesSuggestions: suggestion chips under Notes (IPFT's common
//   PFT-failure notes) — tapping appends into the notes textarea.
//
// Documents render as a thumbnail grid (image preview for JPEG/PNG, a
// file-type icon otherwise) — mirrors a Windows-style large-icon folder view,
// title + date underneath. Also owns multi-select: Bundle Share (zip, any
// file type) and Print-ready Dossier (PDF, images only) — see bundle-share.js.

import {
  addDocument, getDocumentsByCategoryFlat, getDocumentsByFolder,
  getTitleOptions, addTitleOption, renameTitleOption, deleteTitleOption,
} from "./db.js";
import { encryptBytes, decryptBytes } from "./crypto.js";
import { fileTypeFromFile } from "./filetype.js";
import { openDocument, shareDocument } from "./share.js";
import { extractText } from "./ocr.js";
import { shareBundleZip, shareDossierPdf } from "./bundle-share.js";
import { createDateField } from "./date-field.js";

const TITLE_OPTION_OTHERS = "Others";

export async function renderDocsPanel(container, ctx, category, folderId, options = {}) {
  const manageableCategoryKey = options.manageableCategoryKey ?? null;
  let titleOptions = options.titleOptions ?? [];
  if (manageableCategoryKey) {
    const managed = await getTitleOptions(ctx.db, manageableCategoryKey);
    titleOptions = [...managed.map((o) => o.label), TITLE_OPTION_OTHERS];
  }
  const extraFields = options.extraFields ?? [];
  const notesSuggestions = options.notesSuggestions ?? [];

  const panel = document.createElement("div");
  panel.className = "docs-panel";
  const form = document.createElement("form");

  // "Choose file" (any type) and "Scan" (camera, image-only) both feed the
  // same selectedFile — whichever the user used last wins.
  let selectedFile = null;
  const pickRow = document.createElement("div");
  pickRow.className = "pick-row";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.id = "docs-panel-file-" + Math.random().toString(36).slice(2);
  fileInput.hidden = true;
  const fileLabel = document.createElement("label");
  fileLabel.setAttribute("for", fileInput.id);
  fileLabel.className = "pick-btn";
  fileLabel.textContent = "📁 Choose file";

  const scanInput = document.createElement("input");
  scanInput.type = "file";
  scanInput.accept = "image/*";
  scanInput.capture = "environment";
  scanInput.id = "docs-panel-scan-" + Math.random().toString(36).slice(2);
  scanInput.hidden = true;
  const scanLabel = document.createElement("label");
  scanLabel.setAttribute("for", scanInput.id);
  scanLabel.className = "pick-btn";
  scanLabel.textContent = "📷 Scan";

  const pickedNameEl = document.createElement("p");
  pickedNameEl.className = "hint";

  fileInput.addEventListener("change", () => {
    if (fileInput.files[0]) { selectedFile = fileInput.files[0]; pickedNameEl.textContent = selectedFile.name; }
  });
  scanInput.addEventListener("change", () => {
    if (scanInput.files[0]) { selectedFile = scanInput.files[0]; pickedNameEl.textContent = selectedFile.name; }
  });

  pickRow.append(fileInput, fileLabel, scanInput, scanLabel);
  form.append(pickRow, pickedNameEl);

  // ---------- Title: free text, or a chip picker (Others -> custom text) ----------

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.placeholder = "Title";

  let selectedTitleOption = titleOptions[0] ?? "";
  const customTitleInput = document.createElement("input");
  customTitleInput.type = "text";
  customTitleInput.placeholder = "Custom title";
  customTitleInput.hidden = true;

  function resolvedTitle() {
    if (!titleOptions.length) return titleInput.value.trim();
    return selectedTitleOption === TITLE_OPTION_OTHERS ? customTitleInput.value.trim() : selectedTitleOption;
  }

  let titleChipsWrap = null;
  if (titleOptions.length) {
    const titleRow = document.createElement("div");
    titleRow.className = "title-row";
    const titleLabel = document.createElement("span");
    titleLabel.textContent = "Title";
    titleRow.appendChild(titleLabel);
    if (manageableCategoryKey) {
      const manageBtn = document.createElement("button");
      manageBtn.type = "button";
      manageBtn.className = "manage-link";
      manageBtn.textContent = "Manage";
      manageBtn.addEventListener("click", () => {
        openManageTitleOptions(ctx.db, manageableCategoryKey, () => renderDocsPanel(container, ctx, category, folderId, options));
      });
      titleRow.appendChild(manageBtn);
    }
    form.appendChild(titleRow);

    titleChipsWrap = document.createElement("div");
    titleChipsWrap.className = "subtype-row";
    titleOptions.forEach((opt, i) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = opt;
      chip.className = "chip" + (i === 0 ? " chip-selected" : "");
      chip.addEventListener("click", () => {
        selectedTitleOption = opt;
        titleChipsWrap.querySelectorAll(".chip").forEach((c) => c.classList.remove("chip-selected"));
        chip.classList.add("chip-selected");
        customTitleInput.hidden = opt !== TITLE_OPTION_OTHERS;
      });
      titleChipsWrap.appendChild(chip);
    });
    form.append(titleChipsWrap, customTitleInput);
  } else {
    form.appendChild(titleInput);
  }

  // Text extra fields read live off their <input>; date extra fields (and
  // the generic fallback below) are select-driven, so their value is tracked
  // in this object instead — mirrors android's DocumentsPanel.kt genericDate.
  const extraInputs = {};
  const extraDateValues = {};
  extraFields.forEach((field) => {
    if (field.isDate) {
      extraDateValues[field.key] = "";
      form.appendChild(createDateField(field.label, "", (v) => { extraDateValues[field.key] = v; }));
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = field.label;
      extraInputs[field.key] = input;
      form.appendChild(input);
    }
  });

  // Every category gets a date field one way or another — the
  // category-specific one above (CORO/Certificates/Driving License) if it
  // has one, otherwise this generic one (customFields.entry_date).
  const hasDateField = extraFields.some((f) => f.isDate);
  let genericDateValue = "";
  if (!hasDateField) {
    form.appendChild(createDateField("Date", "", (v) => { genericDateValue = v; }));
  }

  const tagsInput = document.createElement("input");
  tagsInput.type = "text";
  tagsInput.placeholder = "Tags (comma separated)";
  form.appendChild(tagsInput);

  const notesInput = document.createElement("textarea");
  notesInput.placeholder = "Notes";
  form.appendChild(notesInput);

  if (notesSuggestions.length) {
    const suggestWrap = document.createElement("div");
    suggestWrap.className = "subtype-row";
    notesSuggestions.forEach((suggestion) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = suggestion;
      chip.addEventListener("click", () => {
        notesInput.value = notesInput.value.trim() ? `${notesInput.value}, ${suggestion}` : suggestion;
      });
      suggestWrap.appendChild(chip);
    });
    form.appendChild(suggestWrap);
  }

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.textContent = "Save Docu";
  form.appendChild(saveBtn);

  // ---------- Selection toolbar (Bundle Share / PDF Dossier) ----------

  const toolbar = document.createElement("div");
  toolbar.className = "select-toolbar";
  const toolbarLabel = document.createElement("span");
  const selectToggleBtn = document.createElement("button");
  selectToggleBtn.type = "button";
  selectToggleBtn.textContent = "Select";
  toolbar.append(toolbarLabel, selectToggleBtn);

  const actionRow = document.createElement("div");
  actionRow.className = "select-actions";
  actionRow.hidden = true;
  const bundleBtn = document.createElement("button");
  bundleBtn.type = "button";
  bundleBtn.textContent = "Bundle share";
  const dossierBtn = document.createElement("button");
  dossierBtn.type = "button";
  dossierBtn.textContent = "PDF dossier";
  dossierBtn.hidden = true;
  actionRow.append(bundleBtn, dossierBtn);

  const grid = document.createElement("div");
  grid.className = "doc-grid";

  let selectMode = false;
  let selectedIds = new Set();
  let currentDocs = [];
  const thumbUrlCache = new Map(); // doc.id -> object URL, revoked on refresh

  function updateToolbar() {
    toolbarLabel.textContent = selectMode ? `${selectedIds.size} selected` : "Docus";
    selectToggleBtn.textContent = selectMode ? "Cancel" : "Select";
    actionRow.hidden = !selectMode || selectedIds.size === 0;
    if (actionRow.hidden) return;
    const selectedDocs = currentDocs.filter((d) => selectedIds.has(d.id));
    dossierBtn.hidden = !(selectedDocs.length && selectedDocs.every((d) => d.fileType === "JPEG" || d.fileType === "PNG"));
  }

  selectToggleBtn.addEventListener("click", () => {
    selectMode = !selectMode;
    selectedIds = new Set();
    updateToolbar();
    renderGrid();
  });

  bundleBtn.addEventListener("click", async () => {
    const selectedDocs = currentDocs.filter((d) => selectedIds.has(d.id));
    bundleBtn.disabled = true;
    try {
      await shareBundleZip(ctx.fileKey, selectedDocs);
    } finally {
      bundleBtn.disabled = false;
      selectMode = false;
      selectedIds = new Set();
      updateToolbar();
      renderGrid();
    }
  });

  dossierBtn.addEventListener("click", async () => {
    const selectedDocs = currentDocs.filter((d) => selectedIds.has(d.id));
    dossierBtn.disabled = true;
    try {
      await shareDossierPdf(ctx.fileKey, selectedDocs);
    } finally {
      dossierBtn.disabled = false;
      selectMode = false;
      selectedIds = new Set();
      updateToolbar();
      renderGrid();
    }
  });

  function revokeThumbUrls() {
    thumbUrlCache.forEach((url) => URL.revokeObjectURL(url));
    thumbUrlCache.clear();
  }

  async function thumbnailFor(doc) {
    if (doc.fileType !== "JPEG" && doc.fileType !== "PNG") return null;
    if (thumbUrlCache.has(doc.id)) return thumbUrlCache.get(doc.id);
    try {
      const bytes = await decryptBytes(ctx.fileKey, doc.iv, doc.ciphertext);
      const mime = doc.fileType === "JPEG" ? "image/jpeg" : "image/png";
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      thumbUrlCache.set(doc.id, url);
      return url;
    } catch {
      return null;
    }
  }

  function formatShortDate(epoch) {
    return new Date(epoch).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  async function renderGrid() {
    revokeThumbUrls();
    grid.innerHTML = "";
    if (currentDocs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "doc-grid-empty";
      empty.innerHTML = `<span class="doc-grid-empty-icon">📄</span><strong>No Docus yet</strong><span>Choose a file or scan one above to add it here.</span>`;
      grid.appendChild(empty);
      return;
    }
    for (const doc of currentDocs) {
      const card = document.createElement(selectMode ? "div" : "button");
      card.className = "doc-card";
      if (!selectMode) card.type = "button";

      const thumbBox = document.createElement("div");
      thumbBox.className = "doc-thumb";
      const url = await thumbnailFor(doc);
      if (url) {
        const img = document.createElement("img");
        img.src = url;
        thumbBox.appendChild(img);
      } else {
        const icon = document.createElement("span");
        icon.className = "doc-thumb-icon";
        icon.textContent = doc.fileType === "PDF" ? "📄" : "📎";
        thumbBox.appendChild(icon);
      }

      if (selectMode) {
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "doc-thumb-check";
        checkbox.checked = selectedIds.has(doc.id);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selectedIds.add(doc.id); else selectedIds.delete(doc.id);
          updateToolbar();
        });
        thumbBox.appendChild(checkbox);
        card.addEventListener("click", () => { checkbox.checked = !checkbox.checked; checkbox.dispatchEvent(new Event("change")); });
      } else {
        const shareBtn = document.createElement("button");
        shareBtn.type = "button";
        shareBtn.className = "doc-thumb-share";
        shareBtn.textContent = "↗";
        shareBtn.addEventListener("click", (e) => { e.stopPropagation(); shareDocument(ctx.fileKey, doc); });
        thumbBox.appendChild(shareBtn);
        card.addEventListener("click", () => openDocument(ctx.fileKey, doc));
      }

      const nameEl = document.createElement("div");
      nameEl.className = "doc-card-title";
      nameEl.textContent = doc.title;
      const dateEl = document.createElement("div");
      dateEl.className = "doc-card-date";
      dateEl.textContent = formatShortDate(doc.uploadDate);

      card.append(thumbBox, nameEl, dateEl);
      grid.appendChild(card);
    }
  }

  async function refreshList() {
    currentDocs = folderId == null
      ? await getDocumentsByCategoryFlat(ctx.db, category.id)
      : await getDocumentsByFolder(ctx.db, folderId);
    await renderGrid();
    updateToolbar();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!selectedFile) return;
    if (!resolvedTitle()) return;
    const file = selectedFile;

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    try {
      const arrayBuffer = await file.arrayBuffer();
      const { iv, ciphertext } = await encryptBytes(ctx.fileKey, arrayBuffer);
      const fileType = fileTypeFromFile(file);

      // Best-effort text extraction for photographed docs — never blocks the
      // upload if OCR fails (extractText already swallows its own errors).
      const ocrText = (fileType === "JPEG" || fileType === "PNG") ? await extractText(file) : "";

      const customFields = {};
      extraFields.forEach((field) => {
        const value = field.isDate ? extraDateValues[field.key] : extraInputs[field.key].value.trim();
        if (value) customFields[field.key] = value;
      });
      if (!hasDateField && genericDateValue) customFields.entry_date = genericDateValue;

      await addDocument(ctx.db, {
        categoryId: category.id,
        folderId,
        title: resolvedTitle() || file.name,
        iv,
        ciphertext,
        fileType,
        customFields,
        tags: tagsInput.value.split(",").map((t) => t.trim()).filter(Boolean),
        notes: notesInput.value.trim() || null,
        ocrText: ocrText || undefined,
      });

      form.reset();
      selectedFile = null;
      pickedNameEl.textContent = "";
      selectedTitleOption = titleOptions[0] ?? "";
      customTitleInput.hidden = true;
      titleChipsWrap?.querySelectorAll(".chip").forEach((c, i) => c.classList.toggle("chip-selected", i === 0));
      extraFields.forEach((field) => { if (field.isDate) extraDateValues[field.key] = ""; });
      genericDateValue = "";
      await refreshList();
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Docu";
    }
  });

  panel.append(form, toolbar, actionRow, grid);
  container.innerHTML = "";
  container.appendChild(panel);
  await refreshList();
}

/**
 * The 19 CORO / 7 Misc default titles are just a starting point — every one
 * can be renamed or deleted, and new ones added, here. "Others" (always
 * available on the upload form itself) isn't part of this list — it's a
 * permanent free-text escape hatch, not a preset. Built as a floating
 * overlay (not static markup) since it's reachable from any docs-panel.
 */
async function openManageTitleOptions(db, categoryKey, onClose) {
  const overlay = document.createElement("div");
  overlay.className = "quick-add-overlay";
  const sheet = document.createElement("div");
  sheet.className = "quick-add-sheet";
  sheet.innerHTML = `<h3>Manage titles</h3><ul class="document-list" id="manage-title-list"></ul>
    <div class="folder-add"><input id="manage-title-new" placeholder="New title" /><button id="manage-title-add">Add</button></div>
    <button id="manage-title-done" class="folder-add-btn">Done</button>`;
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  async function refresh() {
    const options = await getTitleOptions(db, categoryKey);
    const list = sheet.querySelector("#manage-title-list");
    list.innerHTML = "";
    options.forEach((option) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = option.label;
      const editBtn = document.createElement("button");
      editBtn.textContent = "✎";
      editBtn.addEventListener("click", async () => {
        const newLabel = window.prompt("Rename", option.label);
        if (newLabel && newLabel.trim()) { await renameTitleOption(db, option, newLabel.trim()); await refresh(); }
      });
      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "🗑";
      deleteBtn.addEventListener("click", async () => {
        if (window.confirm(`Delete "${option.label}"? Docus already saved under this title keep it — this only removes it from the picker.`)) {
          await deleteTitleOption(db, option);
          await refresh();
        }
      });
      li.append(label, editBtn, deleteBtn);
      list.appendChild(li);
    });
  }

  sheet.querySelector("#manage-title-add").addEventListener("click", async () => {
    const input = sheet.querySelector("#manage-title-new");
    if (!input.value.trim()) return;
    const count = (await getTitleOptions(db, categoryKey)).length;
    await addTitleOption(db, categoryKey, input.value.trim(), count);
    input.value = "";
    await refresh();
  });
  sheet.querySelector("#manage-title-done").addEventListener("click", () => {
    overlay.remove();
    onClose();
  });

  await refresh();
}
