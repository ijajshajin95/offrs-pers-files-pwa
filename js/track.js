// "Keep Track of.." — mirrors android's TrackScreen.kt/TrackerDetailScreen.kt
// exactly (same fixed seed lists, same cadence/due-date logic). Two sections:
//   Ledger: fixed Diff Alce / Misc trackers (+ user-added), each a running
//     list of date/amount/name/note entries with an optional reminder cadence.
//   Checklist: fixed Bengali Pers Docu checklist, tick when verified; ticks
//     auto-expire per their cadence so it re-prompts (see checklistIsDue).
// No documents involved here — this is a plain dated ledger, not a category.

import {
  getTrackerItems, addCustomTracker, setTrackerCadence, getTrackerEntries, addTrackerEntry, deleteTrackerEntry,
  getLastEntryDates, trackerNextDueEpoch, getChecklistItems, setChecklistTicked, checklistIsDue,
  addChecklistItem, deleteChecklistItem, getAllDocumentsSorted,
} from "./db.js";
import { createDateField } from "./date-field.js";

const GROUPS = [
  { key: "diff_alce", label: "Diff Alce" },
  { key: "misc_track", label: "Misc" },
];
const CADENCE_OPTIONS = [["off", "Off"], ["monthly", "Monthly"], ["quarterly", "Quarterly"], ["biannual", "Bi-annual"], ["annual", "Annual"]];
const CADENCE_LABELS = Object.fromEntries(CADENCE_OPTIONS);

let ctx; // { db, showView, pushBack } — see app.js

export function initTrack(context) {
  ctx = context;
}

/** true if any ledger tracker, checklist item, or expiring document (Driving License etc.) is currently due — powers the nav-bar badge dot. */
export async function anyTrackReminderDue() {
  const now = Date.now();
  const [items, lastDates, checklist, docs] = await Promise.all([
    getTrackerItems(ctx.db), getLastEntryDates(ctx.db), getChecklistItems(ctx.db), getAllDocumentsSorted(ctx.db),
  ]);
  const ledgerDue = items.some((item) => {
    const due = trackerNextDueEpoch(item, lastDates[item.id]);
    return due != null && due <= now;
  });
  if (ledgerDue) return true;
  if (checklist.some((item) => checklistIsDue(item, now))) return true;
  return docs.some((doc) => {
    const expiry = doc.customFields?.expiry_date;
    const epoch = expiry ? parseDateValueToEpoch(expiry) : null;
    return epoch != null && epoch <= now;
  });
}

// ---------- Ledger ----------

export async function renderTrackLedger() {
  const container = document.getElementById("track-ledger-content");
  container.innerHTML = "";

  const [items, lastDates] = await Promise.all([getTrackerItems(ctx.db), getLastEntryDates(ctx.db)]);
  const now = Date.now();

  for (const group of GROUPS) {
    const wrap = document.createElement("div");
    wrap.className = "track-group";
    const heading = document.createElement("h3");
    heading.textContent = group.label;
    wrap.appendChild(heading);

    const groupItems = items.filter((i) => i.groupKey === group.key);
    groupItems.forEach((tracker) => {
      const due = trackerNextDueEpoch(tracker, lastDates[tracker.id]);
      const isDue = due != null && due <= now;

      const row = document.createElement("button");
      row.className = "tracker-row";
      row.innerHTML = `
        <span class="tracker-row-text">
          <span class="tracker-row-title">${escapeHtml(tracker.name)}</span>
          <span class="tracker-row-sub">${lastDates[tracker.id] ? "Last entry: " + formatShortDate(lastDates[tracker.id]) : "No entries yet"}</span>
        </span>
        ${isDue ? '<span class="due-badge">Due</span>' : ""}
      `;
      row.addEventListener("click", () => openTrackerDetail(tracker));
      wrap.appendChild(row);
    });

    const addBtn = document.createElement("button");
    addBtn.className = "folder-add-btn";
    addBtn.textContent = "+ Add more";
    addBtn.addEventListener("click", async () => {
      const name = window.prompt(`Add to ${group.label}`);
      if (!name || !name.trim()) return;
      await addCustomTracker(ctx.db, group.key, name.trim(), groupItems.length);
      await renderTrackLedger();
    });
    wrap.appendChild(addBtn);

    container.appendChild(wrap);
  }
}

async function openTrackerDetail(tracker) {
  ctx.showView("tracker-detail");
  // showView only toggles visibility, never re-renders — without refreshing
  // here, any entry added on this screen never shows up in the ledger list's
  // "Last entry: ..." line after backing out, a real bug (looked like
  // entries weren't saving at all).
  const onBack = () => { ctx.showView("track"); renderTrackLedger(); };
  ctx.pushBack(onBack);
  document.getElementById("tracker-detail-title").textContent = tracker.name;
  document.getElementById("tracker-detail-back").onclick = () => history.back();

  const content = document.getElementById("tracker-detail-content");
  content.innerHTML = "";

  // Reminder cadence
  const cadenceRow = document.createElement("div");
  cadenceRow.className = "cadence-row";
  const cadenceLabel = document.createElement("span");
  cadenceLabel.textContent = "Reminder: ";
  const cadenceSelect = document.createElement("select");
  CADENCE_OPTIONS.forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    cadenceSelect.appendChild(opt);
  });
  cadenceSelect.value = tracker.reminderCadence ?? "monthly";
  cadenceSelect.addEventListener("change", async () => {
    await setTrackerCadence(ctx.db, tracker, cadenceSelect.value);
    tracker.reminderCadence = cadenceSelect.value;
  });
  cadenceRow.append(cadenceLabel, cadenceSelect);
  content.appendChild(cadenceRow);

  // Add-entry form
  const form = document.createElement("div");
  form.className = "course-form";
  form.innerHTML = `
    <div id="tracker-entry-date-container"></div>
    <input id="tracker-entry-amount" placeholder="Amount (৳)" inputmode="decimal" />
    <input id="tracker-entry-name" placeholder="Name" />
    <input id="tracker-entry-note" placeholder="Note" />
    <button id="tracker-entry-save">Save entry</button>
  `;
  let entryDateValue = "";
  form.querySelector("#tracker-entry-date-container").appendChild(
    createDateField("Dt received", "", (v) => { entryDateValue = v; }),
  );
  content.appendChild(form);

  const amountInput = form.querySelector("#tracker-entry-amount");
  amountInput.addEventListener("input", () => {
    const filtered = amountInput.value.replace(/[^0-9.]/g, "");
    amountInput.value = filtered.split(".").length > 2
      ? filtered.slice(0, filtered.lastIndexOf("."))
      : filtered;
  });

  const histHeading = document.createElement("h3");
  histHeading.textContent = "Hist";
  content.appendChild(histHeading);

  const list = document.createElement("ul");
  list.className = "document-list";
  content.appendChild(list);

  async function refreshEntries() {
    const entries = await getTrackerEntries(ctx.db, tracker.id);
    list.innerHTML = "";
    if (entries.length === 0) {
      const empty = document.createElement("li");
      empty.className = "history-empty";
      empty.textContent = "No entries yet — save one above to start tracking.";
      list.appendChild(empty);
      return;
    }
    entries.forEach((entry) => {
      const li = document.createElement("li");
      li.className = "entry-row";
      const label = document.createElement("span");
      const parts = [`৳${entry.amount}`, entry.name, formatShortDate(entry.dateEpoch)].filter(Boolean);
      if (entry.note) parts.push(entry.note);
      label.textContent = parts.join(" — ");
      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "row-icon-btn row-icon-delete";
      deleteBtn.textContent = "🗑";
      deleteBtn.setAttribute("aria-label", "Delete entry");
      deleteBtn.addEventListener("click", async () => {
        if (window.confirm(`Delete "${parts.join(" — ")}"? This is permanent.`)) {
          await deleteTrackerEntry(ctx.db, entry.id);
          await refreshEntries();
        }
      });
      li.append(label, deleteBtn);
      list.appendChild(li);
    });
  }

  form.querySelector("#tracker-entry-save").addEventListener("click", async () => {
    const amount = parseFloat(form.querySelector("#tracker-entry-amount").value);
    if (Number.isNaN(amount)) return;
    const dateEpoch = parseDateValueToEpoch(entryDateValue) ?? Date.now();
    await addTrackerEntry(ctx.db, {
      trackerItemId: tracker.id,
      dateEpoch,
      amount,
      name: form.querySelector("#tracker-entry-name").value.trim(),
      note: form.querySelector("#tracker-entry-note").value.trim() || null,
    });
    form.querySelector("#tracker-entry-amount").value = "";
    form.querySelector("#tracker-entry-name").value = "";
    form.querySelector("#tracker-entry-note").value = "";
    await refreshEntries();
  });

  await refreshEntries();
}

// ---------- Checklist ----------
// Two sections sharing one store: "pers_docu" (fixed Bengali list) and
// "general" (English, seeded with one example) — see db.js's section field.

const CHECKLIST_SECTIONS = [
  { key: "pers_docu", label: "Pers Docu Checklist" },
  { key: "general", label: "General Checklist" },
];
const CHECKLIST_CADENCE_OPTIONS = [["monthly", "Monthly"], ["bi_annual", "Bi-annual"], ["annual", "Annual"], ["once", "One-time"]];

export async function renderTrackChecklist() {
  const container = document.getElementById("track-checklist-content");
  container.innerHTML = "";

  const items = await getChecklistItems(ctx.db);
  const now = Date.now();

  // Cadence elapsed since last tick — auto-clear so the checkbox visually
  // resets and the item reads as "needs recheck" again, per the app's spec.
  const toReset = items.filter((item) => item.tickedAt != null && checklistIsDue(item, now));
  for (const item of toReset) {
    await setChecklistTicked(ctx.db, item, false);
    item.tickedAt = null;
  }

  CHECKLIST_SECTIONS.forEach(({ key: section, label: heading }) => {
    const wrap = document.createElement("div");
    wrap.className = "track-group";
    const headingEl = document.createElement("h3");
    headingEl.textContent = heading;
    wrap.appendChild(headingEl);

    const sectionItems = items.filter((i) => i.section === section);
    sectionItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "checklist-row";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.tickedAt != null;
      checkbox.addEventListener("change", async () => {
        await setChecklistTicked(ctx.db, item, checkbox.checked);
        item.tickedAt = checkbox.checked ? Date.now() : null;
      });

      const text = document.createElement("div");
      text.className = "checklist-row-text";
      text.innerHTML = `<span>${escapeHtml(item.textBn)}</span><span class="checklist-row-cadence">${cadenceLabel(item.cadence)}</span>`;

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "row-icon-btn row-icon-delete";
      deleteBtn.textContent = "🗑";
      deleteBtn.addEventListener("click", async () => {
        if (window.confirm("Delete this checklist entry?")) { await deleteChecklistItem(ctx.db, item); await renderTrackChecklist(); }
      });

      row.append(checkbox, text, deleteBtn);
      wrap.appendChild(row);
    });

    const addBtn = document.createElement("button");
    addBtn.className = "folder-add-btn";
    addBtn.textContent = "+ Add";
    addBtn.addEventListener("click", () => openAddChecklistItem(section, sectionItems.length));
    wrap.appendChild(addBtn);

    container.appendChild(wrap);
  });
}

function openAddChecklistItem(section, sortOrder) {
  const overlay = document.createElement("div");
  overlay.className = "quick-add-overlay";
  const sheet = document.createElement("div");
  sheet.className = "quick-add-sheet";
  sheet.innerHTML = `
    <h3>Add checklist entry</h3>
    <input type="text" id="checklist-add-text" placeholder="Entry" style="width:100%; box-sizing:border-box; background:var(--surface-elevated); border:1px solid var(--border); border-radius:10px; color:var(--text); padding:11px; font:inherit; margin-bottom:10px;" />
    <select id="checklist-add-cadence" style="width:100%; box-sizing:border-box; background:var(--surface-elevated); border:1px solid var(--border); border-radius:10px; color:var(--text); padding:11px; font:inherit; margin-bottom:14px;"></select>
    <button id="checklist-add-save" class="folder-add-btn">Add</button>
    <button id="checklist-add-cancel" class="folder-add-btn">Cancel</button>
  `;
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  const cadenceSelect = sheet.querySelector("#checklist-add-cadence");
  CHECKLIST_CADENCE_OPTIONS.forEach(([value, label]) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    cadenceSelect.appendChild(opt);
  });
  cadenceSelect.value = "annual";

  sheet.querySelector("#checklist-add-save").addEventListener("click", async () => {
    const text = sheet.querySelector("#checklist-add-text").value.trim();
    if (!text) return;
    await addChecklistItem(ctx.db, text, cadenceSelect.value, section, sortOrder);
    overlay.remove();
    await renderTrackChecklist();
  });
  sheet.querySelector("#checklist-add-cancel").addEventListener("click", () => overlay.remove());
}

function cadenceLabel(cadence) {
  switch (cadence) {
    case "monthly": return "Monthly re-check";
    case "bi_annual": return "Bi-annual re-check";
    case "annual": return "Annual re-check";
    case "once": return "One-time";
    default: return cadence;
  }
}

function formatShortDate(epoch) {
  return new Date(epoch).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** DatePickerField's "" / "yyyy" / "yyyy-MM" / "yyyy-MM-dd" format, defaulting missing month/day to the 1st. */
function parseDateValueToEpoch(value) {
  if (!value) return null;
  const parts = value.split("-").map(Number);
  const year = parts[0];
  if (!year) return null;
  const month = parts[1] || 1;
  const day = parts[2] || 1;
  return new Date(year, month - 1, day).getTime();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}
