// Every document across every category, newest first, grouped by year —
// mirrors android's TimelineScreen.kt + TimelineDate.kt exactly (same field
// names, same fallback order): CORO/certificate date fields, a course
// folder's own date, or the IPFT/RET Year folder it lives in, falling back to
// upload date only when none of that is available.

import { getAllDocumentsSorted, getAllCategories, getAllFolders } from "./db.js";
import { categoryAccent, categoryEmoji } from "./theme.js";
import { openDocument } from "./share.js";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function tryDate(year, month, day) {
  if (year < 1900 || year > 2100) return null;
  const d = new Date(year, month, day);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

// Free-text fields the user typed with no enforced format — best-effort
// across the handful of formats people actually use; unparseable input
// returns null and the caller falls through to the next candidate.
function parseFlexibleDate(text) {
  if (!text) return null;
  const t = String(text).trim();
  if (!t) return null;

  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return tryDate(+m[1], +m[2] - 1, +m[3]);

  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return tryDate(+m[3], +m[2] - 1, +m[1]);

  const short = (name) => name.slice(0, 3).toLowerCase();
  m = t.match(/^(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})$/);
  if (m) {
    const mon = MONTH_NAMES.findIndex((n) => short(n) === short(m[2]));
    if (mon >= 0) return tryDate(+m[3], mon, +m[1]);
  }
  m = t.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mon = MONTH_NAMES.findIndex((n) => short(n) === short(m[1]));
    if (mon >= 0) return tryDate(+m[3], mon, +m[2]);
  }

  // Day/Month/Year picker can produce a year-and-month-only value ("2026-07")
  // with no day chosen.
  m = t.match(/^(\d{4})-(\d{2})$/);
  if (m) return tryDate(+m[1], +m[2] - 1, 1);

  m = t.match(/^(\d{4})$/);
  if (m) return tryDate(+m[1], 0, 1);

  return null;
}

/** foldersById: { [id]: folder } — from db.js's getAllFolders, keyed by id. */
function resolveTimelineDate(doc, foldersById) {
  const fields = doc.customFields ?? {};
  for (const key of ["coro_date", "issue_date", "entry_date"]) {
    const parsed = parseFlexibleDate(fields[key]);
    if (parsed) return parsed;
  }

  const folder = doc.folderId != null ? foldersById[doc.folderId] : null;
  if (folder) {
    const parsed = parseFlexibleDate((folder.meta ?? {}).date);
    if (parsed) return parsed;

    if (/^\d{4}$/.test(folder.name)) {
      const year = parseInt(folder.name, 10);
      if (year >= 1900 && year <= 2100) return tryDate(year, 0, 1);
    }
    const parent = folder.parentFolderId != null ? foldersById[folder.parentFolderId] : null;
    if (parent && /^\d{4}$/.test(parent.name)) {
      const year = parseInt(parent.name, 10);
      if (year >= 1900 && year <= 2100) {
        const month = folder.name.startsWith("2nd") ? 6 : 0;
        return tryDate(year, month, 1);
      }
    }
  }

  return doc.uploadDate;
}

export async function renderTimeline(container, ctx, categoriesById) {
  const [docs, categories] = await Promise.all([getAllDocumentsSorted(ctx.db), getAllCategories(ctx.db)]);
  const folders = await getAllFolders(ctx.db, categories);
  const foldersById = Object.fromEntries(folders.map((f) => [f.id, f]));

  const sorted = [...docs].sort((a, b) => resolveTimelineDate(b, foldersById) - resolveTimelineDate(a, foldersById));

  container.innerHTML = "";

  if (sorted.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Docus you add will show up here, newest first.";
    container.appendChild(empty);
    return;
  }

  let lastYear = null;
  const list = document.createElement("div");
  list.className = "timeline-list";

  sorted.forEach((doc) => {
    const resolvedDate = resolveTimelineDate(doc, foldersById);
    const date = new Date(resolvedDate);
    const year = date.getFullYear();
    if (year !== lastYear) {
      lastYear = year;
      const heading = document.createElement("h3");
      heading.className = "timeline-year";
      heading.textContent = String(year);
      list.appendChild(heading);
    }

    const category = categoriesById[doc.categoryId];
    const accent = category ? categoryAccent(category.key) : "#2d6a4f";
    const emoji = category ? categoryEmoji(category.key) : "📁";

    const row = document.createElement("button");
    row.className = "timeline-row";
    row.innerHTML = `
      <span class="icon-badge" style="background:${accent}22">${emoji}</span>
      <span class="timeline-row-text">
        <span class="timeline-row-title">${escapeHtml(doc.title)}</span>
        <span class="timeline-row-sub">${escapeHtml(category?.displayName ?? "")} · ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}</span>
      </span>
    `;
    row.addEventListener("click", () => openDocument(ctx.fileKey, doc));
    list.appendChild(row);
  });

  container.appendChild(list);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}
