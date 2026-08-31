// Folder browser for the 3 structured categories:
//   IPFT: Year -> 1st/2nd Bi-Annual -> documents
//   RET: Year -> documents
//   Course/Cadre: user-created course folder (meta: course_name, institution,
//     date, result_position, grade) -> documents tagged by doc_subtype
//
// Mirrors android's FolderBrowserScreen.kt + FolderRepository.kt. Document
// upload/list itself is handled by the shared renderDocsPanel (docs-panel.js).
// Header/back-button/content-container elements are owned by app.js and
// reached through ctx, so this module stays free of DOM-id assumptions.

import {
  getChildFolders, createFolder, getOrCreateNamedFolder, renameFolder, deleteFolder, countDocumentsInFolder,
  COURSE_CADRE_DEFAULT_COURSES, YEAR_SEED_START, CORO_DEFAULT_TITLE_OPTIONS, MISC_DEFAULT_TITLE_OPTIONS,
} from "./db.js";
import { renderDocsPanel } from "./docs-panel.js";
import { createDateField } from "./date-field.js";

const COURSE_DOC_TITLES = ["CORO", "BAO", "Course Report", "Result", "Related Corres", "Exemtion Ltr", "Cert", "Others"];
const IPFT_RET_TITLE_OPTIONS = ["Div Order", "Result", "Related Corres", "Exemtion Ltr", "Others"];
const IPFT_NOTES_SUGGESTIONS = ["Failed twice in Beam", "Struggled in Push-up"];
const CARD_FRONT_BACK = ["Front", "Back"];
const FIN_BANKING_SUBFOLDERS = ["DSOP Fund Statements", "Pay Slip", "Income Tax Returns", "FDRs", "DPSs", "Shanchay Patra"];
const MONTH_NAMES_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DRIVING_LICENSE_SUBFOLDERS = ["Mil Driving License", "Civil Driving License"];
const IMP_CARDS_SUBFOLDERS = ["NID", "Mil ID Card", "Driving License", "Credit/Debit Cards", "Parents' NID", "Spouce's NID", "Children NID"];

let ctx; // { db, fileKey, showView, setHeader, contentEl, metaEl, pushBack } — see app.js

export function initFolderBrowser(context) {
  ctx = context;
}

/** Returns true and takes over the view if this category is structured; false if the caller should render the plain flat category view instead. */
export function openStructuredCategory(category) {
  if (category.key === "ipft") { openIpftYears(category); return true; }
  if (category.key === "ret") { openRetYears(category); return true; }
  if (category.key === "course_cadre") { openCourseList(category); return true; }
  if (category.key === "fin_banking") { openFinBankingRoot(category); return true; }
  if (category.key === "driving_license_docu") { openFixedExpirySubfolders(category, DRIVING_LICENSE_SUBFOLDERS); return true; }
  if (category.key === "yrly_diff_fees") { openExtensibleFixed(category, ["Family Sy Docu"]); return true; }
  if (category.key === "imp_cards") { openFixedTitleOptionSubfolders(category, IMP_CARDS_SUBFOLDERS, CARD_FRONT_BACK); return true; }
  if (category.key === "coro") {
    openExtensibleFixed(category, CORO_DEFAULT_TITLE_OPTIONS, [
      { key: "coro_number", label: "CORO Number" },
      { key: "coro_date", label: "CORO Date", isDate: true },
    ]);
    return true;
  }
  if (category.key === "misc") { openExtensibleFixed(category, MISC_DEFAULT_TITLE_OPTIONS); return true; }
  return false;
}

// ---------- Fixed sub-folders, each with an Expiry Date field (Driving License Docu) ----------

async function openFixedExpirySubfolders(category, subfolderNames) {
  ctx.showView("folder");
  const onBack = () => ctx.showView("home");
  ctx.setHeader(category.displayName, onBack, category.key);
  ctx.pushBack(onBack);

  ctx.contentEl.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "document-list";
  subfolderNames.forEach((name) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "folder-list-btn";
    btn.textContent = name;
    btn.addEventListener("click", async () => {
      const folder = await getOrCreateNamedFolder(ctx.db, category.id, null, name);
      openDocsFolder(category, folder.id, null, () => openFixedExpirySubfolders(category, subfolderNames), {
        extraFields: [{ key: "expiry_date", label: "Expiry Date", isDate: true }],
      });
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
  ctx.contentEl.appendChild(ul);
}

// ---------- Fixed sub-folders, each with a Front/Back title picker (Imp Cards) ----------

async function openFixedTitleOptionSubfolders(category, subfolderNames, titleOptions) {
  ctx.showView("folder");
  const onBack = () => ctx.showView("home");
  ctx.setHeader(category.displayName, onBack, category.key);
  ctx.pushBack(onBack);

  ctx.contentEl.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "document-list";
  subfolderNames.forEach((name) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "folder-list-btn";
    btn.textContent = name;
    btn.addEventListener("click", async () => {
      const folder = await getOrCreateNamedFolder(ctx.db, category.id, null, name);
      openDocsFolder(category, folder.id, null, () => openFixedTitleOptionSubfolders(category, subfolderNames, titleOptions), { titleOptions });
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
  ctx.contentEl.appendChild(ul);
}

// ---------- Fixed sub-folder(s) seeded up front, plus user can add more (Yrly Diff Fees, CORO, Misc) ----------
// Defaults are just a starting point — renamable/deletable via
// appendManagedFolderRow, and "+ Add" still works for anything not on the
// list, same as Course/Cadre's own folder list.

async function openExtensibleFixed(category, seedNames, extraFields = []) {
  for (const name of seedNames) await getOrCreateNamedFolder(ctx.db, category.id, null, name);

  ctx.showView("folder");
  const onBack = () => ctx.showView("home");
  ctx.setHeader(category.displayName, onBack, category.key);
  ctx.pushBack(onBack);

  const folders = await getChildFolders(ctx.db, category.id, null);
  ctx.contentEl.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "document-list";
  folders.forEach((f) => {
    appendManagedFolderRow(
      ul, f,
      (folder) => openDocsFolder(category, folder.id, null, () => openExtensibleFixed(category, seedNames, extraFields), { extraFields }),
      () => openExtensibleFixed(category, seedNames, extraFields),
    );
  });
  ctx.contentEl.appendChild(ul);

  const addWrap = document.createElement("div");
  addWrap.className = "folder-add";
  const input = document.createElement("input");
  input.placeholder = "Name";
  const addBtn = document.createElement("button");
  addBtn.textContent = "+ Add";
  addBtn.addEventListener("click", async () => {
    if (!input.value.trim()) return;
    await getOrCreateNamedFolder(ctx.db, category.id, null, input.value.trim());
    input.value = "";
    openExtensibleFixed(category, seedNames, extraFields);
  });
  addWrap.append(input, addBtn);
  ctx.contentEl.appendChild(addWrap);
}

// ---------- Fin and Banking: fixed sub-folders, Pay Slip alone gets Year -> Month ----------

async function openFinBankingRoot(category) {
  ctx.showView("folder");
  const onBack = () => ctx.showView("home");
  ctx.setHeader(category.displayName, onBack, category.key);
  ctx.pushBack(onBack);

  ctx.contentEl.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "document-list";
  FIN_BANKING_SUBFOLDERS.forEach((name) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "folder-list-btn";
    btn.textContent = name;
    btn.addEventListener("click", async () => {
      const folder = await getOrCreateNamedFolder(ctx.db, category.id, null, name);
      if (name === "Pay Slip") openPaySlipYears(category, folder);
      else openDocsFolder(category, folder.id, null, () => openFinBankingRoot(category));
    });
    li.appendChild(btn);
    ul.appendChild(li);
  });
  ctx.contentEl.appendChild(ul);
}

async function openPaySlipYears(category, payslipFolder) {
  ctx.showView("folder");
  const onBack = () => openFinBankingRoot(category);
  ctx.setHeader("Pay Slip", onBack, category.key);
  ctx.pushBack(onBack);
  await renderYearListView(category.id, payslipFolder.id, (year) => openPaySlipMonths(category, payslipFolder, year));
}

async function openPaySlipMonths(category, payslipFolder, year) {
  ctx.showView("folder");
  const onBack = () => openPaySlipYears(category, payslipFolder);
  ctx.setHeader("Pay Slip", onBack, category.key, year.name);
  ctx.pushBack(onBack);

  ctx.contentEl.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "document-list";
  for (const monthName of MONTH_NAMES_FULL) {
    const month = await getOrCreateNamedFolder(ctx.db, category.id, year.id, monthName);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "folder-list-btn";
    btn.textContent = month.name;
    btn.addEventListener("click", () =>
      openDocsFolder(category, month.id, `${year.name} — ${month.name}`, () => openPaySlipMonths(category, payslipFolder, year))
    );
    li.appendChild(btn);
    ul.appendChild(li);
  }
  ctx.contentEl.appendChild(ul);
}

/**
 * Same as a plain folder-list-btn row, but with edit (rename) and delete
 * icons — used anywhere a list of default-seeded-but-user-owned folders
 * lives (Course/Cadre courses, RET/IPFT years): "these are for ease of
 * guiding them", not fixed. Deleting only removes the folder itself — any
 * documents inside stay on disk and stay findable via Search/Timeline, they
 * just lose this folder's browse path, so the confirm dialog says so.
 */
function appendManagedFolderRow(ul, folder, onSelect, onMutated) {
  const li = document.createElement("li");
  li.className = "managed-folder-row";
  const btn = document.createElement("button");
  btn.className = "folder-list-btn";
  btn.textContent = folder.name;
  btn.addEventListener("click", () => onSelect(folder));

  const editBtn = document.createElement("button");
  editBtn.className = "row-icon-btn";
  editBtn.textContent = "✎";
  editBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const newName = window.prompt("Rename", folder.name);
    if (newName && newName.trim()) { await renameFolder(ctx.db, folder, newName.trim()); onMutated(); }
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "row-icon-btn row-icon-delete";
  deleteBtn.textContent = "🗑";
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const count = await countDocumentsInFolder(ctx.db, folder.id);
    const warning = count > 0
      ? `${count} Docu(s) are filed here — they'll stay safe and still show up in Search/Timeline, but this folder will be gone.`
      : "This folder is empty.";
    if (window.confirm(`Delete "${folder.name}"?\n\n${warning}`)) { await deleteFolder(ctx.db, folder); onMutated(); }
  });

  li.append(btn, editBtn, deleteBtn);
  ul.appendChild(li);
}

// ---------- Shared year-folder list (IPFT + RET both start here) ----------

async function renderYearListView(categoryId, parentFolderId, onSelect) {
  // Editable defaults, not fixed — 2020 through this year exist up front so
  // there's no manual "+ Add Year" grind for years already in the past.
  // Gated on this level being completely empty so far — otherwise deleting
  // (or renaming) a seeded year would just bring it right back on the next
  // visit, defeating the delete button entirely.
  if ((await getChildFolders(ctx.db, categoryId, parentFolderId)).length === 0) {
    const currentYear = new Date().getFullYear();
    for (let year = YEAR_SEED_START; year <= currentYear; year++) {
      await getOrCreateNamedFolder(ctx.db, categoryId, parentFolderId, String(year));
    }
  }
  const years = await getChildFolders(ctx.db, categoryId, parentFolderId);

  ctx.contentEl.innerHTML = "";

  const ul = document.createElement("ul");
  ul.className = "document-list";
  years.forEach((y) => appendManagedFolderRow(ul, y, onSelect, () => renderYearListView(categoryId, parentFolderId, onSelect)));
  ctx.contentEl.appendChild(ul);

  const addWrap = document.createElement("div");
  addWrap.className = "folder-add";
  const input = document.createElement("input");
  input.placeholder = "Year (e.g. 2026)";
  input.maxLength = 4;
  input.inputMode = "numeric";
  const addBtn = document.createElement("button");
  addBtn.textContent = "+ Add Year";
  addBtn.addEventListener("click", async () => {
    if (/^\d{4}$/.test(input.value)) {
      const value = input.value;
      input.value = "";
      const folder = await getOrCreateNamedFolder(ctx.db, categoryId, parentFolderId, value);
      onSelect(folder);
    }
  });
  addWrap.append(input, addBtn);
  ctx.contentEl.appendChild(addWrap);
}

// ---------- IPFT ----------

async function openIpftYears(category) {
  ctx.showView("folder");
  const onBack = () => ctx.showView("home");
  ctx.setHeader(category.displayName, onBack, category.key);
  ctx.pushBack(onBack);
  await renderYearListView(category.id, null, (year) => openIpftBiAnnuals(category, year));
}

async function openIpftBiAnnuals(category, year) {
  ctx.showView("folder");
  const onBack = () => openIpftYears(category);
  ctx.setHeader(category.displayName, onBack, category.key, year.name);
  ctx.pushBack(onBack);

  const first = await getOrCreateNamedFolder(ctx.db, category.id, year.id, "1st Bi-Annual");
  const second = await getOrCreateNamedFolder(ctx.db, category.id, year.id, "2nd Bi-Annual");

  ctx.contentEl.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "document-list";
  [first, second].forEach((b) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "folder-list-btn";
    btn.textContent = b.name;
    btn.addEventListener("click", () =>
      openDocsFolder(category, b.id, `${year.name} — ${b.name}`, () => openIpftBiAnnuals(category, year), {
        titleOptions: IPFT_RET_TITLE_OPTIONS,
        notesSuggestions: IPFT_NOTES_SUGGESTIONS,
      })
    );
    li.appendChild(btn);
    ul.appendChild(li);
  });
  ctx.contentEl.appendChild(ul);
}

// ---------- RET ----------

async function openRetYears(category) {
  ctx.showView("folder");
  const onBack = () => ctx.showView("home");
  ctx.setHeader(category.displayName, onBack, category.key);
  ctx.pushBack(onBack);
  await renderYearListView(category.id, null, (year) =>
    openDocsFolder(category, year.id, year.name, () => openRetYears(category), { titleOptions: IPFT_RET_TITLE_OPTIONS })
  );
}

// ---------- Course/Cadre ----------

async function openCourseList(category) {
  ctx.showView("folder");
  const onBack = () => ctx.showView("home");
  ctx.setHeader(category.displayName, onBack, category.key);
  ctx.pushBack(onBack);
  // Defaults are just a starting point — renamable/deletable, and
  // "+ Add Course" still works for anything not on this list. Gated on the
  // category being completely empty so far — otherwise deleting (or
  // renaming) a default course would just bring it right back on the next
  // visit, defeating the delete button entirely.
  if ((await getChildFolders(ctx.db, category.id, null)).length === 0) {
    for (const name of COURSE_CADRE_DEFAULT_COURSES) await getOrCreateNamedFolder(ctx.db, category.id, null, name);
  }
  const courses = await getChildFolders(ctx.db, category.id, null);
  renderCourseListView(category, courses);
}

function renderCourseListView(category, courses) {
  ctx.contentEl.innerHTML = "";

  const ul = document.createElement("ul");
  ul.className = "document-list";
  courses.forEach((c) => appendManagedFolderRow(ul, c, (course) => openCourseDocs(category, course), () => openCourseList(category)));
  ctx.contentEl.appendChild(ul);

  const addBtn = document.createElement("button");
  addBtn.className = "folder-add-btn";
  addBtn.textContent = "+ Add Course";

  const form = document.createElement("div");
  form.className = "course-form";
  form.hidden = true;
  form.innerHTML = `
    <input id="course-name" placeholder="Course name" />
    <input id="course-institution" placeholder="Institution" />
    <div id="course-date-from-container"></div>
    <div id="course-date-to-container"></div>
    <p id="course-duration" class="hint"></p>
    <input id="course-result" placeholder="Result/Position" />
    <input id="course-grade" placeholder="Grade" />
    <button id="course-save">Save course</button>
  `;

  let courseDateFrom = "";
  let courseDateTo = "";
  const durationEl = form.querySelector("#course-duration");
  function refreshDuration() {
    const weeks = computeDurationWeeks(courseDateFrom, courseDateTo);
    durationEl.textContent = weeks != null ? `Duration: ${weeks} weeks` : "";
  }
  form.querySelector("#course-date-from-container").appendChild(
    createDateField("From", "", (v) => { courseDateFrom = v; refreshDuration(); }),
  );
  form.querySelector("#course-date-to-container").appendChild(
    createDateField("To", "", (v) => { courseDateTo = v; refreshDuration(); }),
  );

  addBtn.addEventListener("click", () => { form.hidden = false; addBtn.hidden = true; });
  form.querySelector("#course-save").addEventListener("click", async () => {
    const name = form.querySelector("#course-name").value.trim();
    if (!name) return;
    const weeks = computeDurationWeeks(courseDateFrom, courseDateTo);
    const meta = {
      course_name: name,
      institution: form.querySelector("#course-institution").value.trim(),
      date: courseDateFrom, // TimelineDate resolution reads folder.meta.date — keep it pointed at the start date
      date_from: courseDateFrom,
      date_to: courseDateTo,
      ...(weeks != null ? { duration_weeks: weeks } : {}),
      result_position: form.querySelector("#course-result").value.trim(),
      grade: form.querySelector("#course-grade").value.trim(),
    };
    const folder = await createFolder(ctx.db, category.id, null, name, meta);
    openCourseDocs(category, folder);
  });

  ctx.contentEl.append(addBtn, form);
}

function openCourseDocs(category, course) {
  ctx.showView("folder");
  const onBack = () => openCourseList(category);
  ctx.setHeader(course.name, onBack, category.key);
  ctx.pushBack(onBack);

  const meta = course.meta || {};
  const labels = { institution: "Institution", date_from: "From", date_to: "To", duration_weeks: "Duration", result_position: "Result/Position", grade: "Grade" };
  ctx.metaEl.innerHTML = Object.entries(labels)
    .filter(([key]) => meta[key])
    .map(([key, label]) => `<p>${label}: ${meta[key]}${key === "duration_weeks" ? " weeks" : ""}</p>`)
    .join("");

  renderDocsPanel(ctx.contentEl, ctx, category, course.id, { titleOptions: COURSE_DOC_TITLES });
}

// ---------- IPFT/RET terminal doc folders (no extra fields) ----------

function openDocsFolder(category, folderId, subtitle, onBack, options = {}) {
  ctx.showView("folder");
  ctx.setHeader(category.displayName, onBack, category.key, subtitle);
  ctx.pushBack(onBack);
  renderDocsPanel(ctx.contentEl, ctx, category, folderId, options);
}

/** Whole weeks between two full "yyyy-MM-dd" DatePickerField values — null until both dates are fully picked (day included). Mirrors android's computeDurationWeeks. */
function computeDurationWeeks(dateFrom, dateTo) {
  if (dateFrom.split("-").length !== 3 || dateTo.split("-").length !== 3) return null;
  const from = new Date(dateFrom).getTime();
  const to = new Date(dateTo).getTime();
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  const days = (to - from) / (24 * 60 * 60 * 1000);
  return Math.max(days === 0 ? 0 : 1, Math.ceil(days / 7));
}
