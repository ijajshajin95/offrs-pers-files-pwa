// Structured Day/Month/Year date input — mirrors android's
// ui/components/DatePickerField.kt exactly (same stored format, same
// day-clamping-on-month-change behaviour). Replaces free-text date entry
// everywhere a date is collected, so "jul" vs "july" vs "26" can't happen.
// Stored value: "" / "yyyy" / "yyyy-MM" / "yyyy-MM-dd".

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDateValue(value) {
  const parts = (value || "").trim().split("-").filter(Boolean);
  if (parts.length === 3) return { day: +parts[2], month: +parts[1], year: +parts[0] };
  if (parts.length === 2) return { day: null, month: +parts[1], year: +parts[0] };
  if (parts.length === 1) return { day: null, month: null, year: +parts[0] };
  return { day: null, month: null, year: null };
}

function formatDateValue(day, month, year) {
  if (!year) return "";
  if (!month) return String(year).padStart(4, "0");
  if (!day) return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysInMonth(year, month) {
  return new Date(year || new Date().getFullYear(), month || 1, 0).getDate();
}

function populate(select, placeholder, options) {
  const prev = select.value;
  select.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholder;
  select.appendChild(opt0);
  options.forEach(([value, text]) => {
    const opt = document.createElement("option");
    opt.value = String(value);
    opt.textContent = text;
    select.appendChild(opt);
  });
  select.value = prev;
}

/**
 * Builds a labeled Day/Month/Year row. `onChange(value)` fires with the
 * formatted string on every selection change. Returns the wrapper element to
 * append into a form.
 */
export function createDateField(label, initialValue, onChange) {
  const wrap = document.createElement("div");
  wrap.className = "date-field";

  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  wrap.appendChild(labelEl);

  const row = document.createElement("div");
  row.className = "date-field-row";

  const daySelect = document.createElement("select");
  const monthSelect = document.createElement("select");
  const yearSelect = document.createElement("select");

  const currentYear = new Date().getFullYear();
  populate(monthSelect, "Month", MONTH_NAMES.map((name, i) => [i + 1, name]));
  populate(yearSelect, "Year", Array.from({ length: currentYear - 1950 + 2 }, (_, i) => currentYear + 1 - i).map((y) => [y, String(y)]));

  const initial = parseDateValue(initialValue);
  populate(daySelect, "Day", Array.from({ length: daysInMonth(initial.year, initial.month) }, (_, i) => [i + 1, String(i + 1)]));
  daySelect.value = initial.day ? String(initial.day) : "";
  monthSelect.value = initial.month ? String(initial.month) : "";
  yearSelect.value = initial.year ? String(initial.year) : "";

  function emit() {
    const day = daySelect.value ? +daySelect.value : null;
    const month = monthSelect.value ? +monthSelect.value : null;
    const year = yearSelect.value ? +yearSelect.value : null;
    onChange(formatDateValue(day, month, year));
  }

  function refreshDays() {
    const year = yearSelect.value ? +yearSelect.value : null;
    const month = monthSelect.value ? +monthSelect.value : null;
    const prevDay = daySelect.value ? +daySelect.value : null;
    const max = daysInMonth(year, month);
    populate(daySelect, "Day", Array.from({ length: max }, (_, i) => [i + 1, String(i + 1)]));
    daySelect.value = prevDay && prevDay <= max ? String(prevDay) : "";
  }

  monthSelect.addEventListener("change", () => { refreshDays(); emit(); });
  yearSelect.addEventListener("change", () => { refreshDays(); emit(); });
  daySelect.addEventListener("change", emit);

  row.append(daySelect, monthSelect, yearSelect);
  wrap.appendChild(row);
  return wrap;
}
