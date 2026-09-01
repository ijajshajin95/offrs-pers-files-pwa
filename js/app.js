import { APP_CONTENT } from "./content.js";
import { openDb, seedBuiltInCategories, seedTrackingData, migrateFlatCoroMiscToFolders, getAllCategories, searchDocuments, getDocCountsByCategory, createCategory, slugifyCategoryName } from "./db.js";
import { categoryAccent, categoryEmoji } from "./theme.js";
import { getOrCreateKey } from "./crypto.js";
import {
  isPinSet, setPin, verifyPin,
  platformAuthAvailable, platformAuthRegistered, registerPlatformAuth, unlockWithPlatformAuth,
  getRecoveryContact, setRecoveryContact,
} from "./lock.js";
import {
  sendPhoneOtp, verifyPhoneOtp, sendEmailRecoveryLink, isEmailRecoveryLink, completeEmailRecoveryLink,
} from "./recovery.js";
import { initFolderBrowser, openStructuredCategory } from "./folder.js";
import { renderDocsPanel } from "./docs-panel.js";
import { openDocument, shareDocument } from "./share.js";
import { exportBackup, importBackup } from "./backup.js";
import { isOnboardingDone, markOnboardingDone, initWelcomeScreen, initNameEntryScreen, getUserName } from "./onboarding.js";
import { renderTimeline } from "./timeline.js";
import { initTrack, renderTrackLedger, renderTrackChecklist, anyTrackReminderDue } from "./track.js";

// Per-category extra fields collected at upload time (mirrors android's
// CategoryScreen.kt). Only flat categories need this here — CORO's fields
// live on its sub-folders and Course/Cadre's on the course folder itself,
// both wired in folder.js.
const EXTRA_FIELDS_BY_CATEGORY = {
  certificates: [
    { key: "cert_name", label: "Certificate Name" },
    { key: "issuing_authority", label: "Issuing Authority" },
    { key: "issue_date", label: "Issue Dt", isDate: true },
  ],
};

// Same idea, for the Title field itself — a chip picker replacing free text
// on the categories that have a fixed set of common titles ("Others" reveals
// a text field for anything else). Mirrors android's per-category constants
// in FolderBrowserScreen.kt/CategoryScreen.kt.
const TITLE_OPTIONS_BY_CATEGORY = {
  jolshiri: ["Money Deposite Docu", "Others"],
};

const welcomeView = document.getElementById("welcome-view");
const nameEntryView = document.getElementById("name-entry-view");
const lockView = document.getElementById("lock-view");
const pinEntryBox = document.getElementById("pin-entry-box");
const recoverySetupBox = document.getElementById("recovery-setup-box");
const forgotPinBox = document.getElementById("forgot-pin-box");
const homeView = document.getElementById("home-view");
const timelineView = document.getElementById("timeline-view");
const folderView = document.getElementById("folder-view");
const searchView = document.getElementById("search-view");
const backupView = document.getElementById("backup-view");
const settingsView = document.getElementById("settings-view");
const trackView = document.getElementById("track-view");
const trackerDetailView = document.getElementById("tracker-detail-view");
const appNav = document.getElementById("app-nav");

let categoriesById = {};

const headerSearchBtn = document.getElementById("header-search-btn");
const folderBannerEl = document.getElementById("folder-banner");
const folderBannerIconEl = document.getElementById("folder-banner-icon");
const folderBackBtn = document.getElementById("folder-back");
const folderTitleEl = document.getElementById("folder-title");
const folderMetaEl = document.getElementById("folder-meta");
const folderContentEl = document.getElementById("folder-content");
const navHomeBtn = document.getElementById("nav-home");
const navTimelineBtn = document.getElementById("nav-timeline");
const navTrackBtn = document.getElementById("nav-track");
const navBackupBtn = document.getElementById("nav-backup");
const navSettingsBtn = document.getElementById("nav-settings");

let db;
let fileKey;
let everUnlocked = false; // true after the first successful unlock this load — gates the re-lock listener below
let appUnlocked = false;  // false whenever the app is backgrounded or still locked

const headerAppNameEl = document.getElementById("about-app-name");

function showView(view) {
  welcomeView.hidden = view !== "welcome";
  nameEntryView.hidden = view !== "name-entry";
  lockView.hidden = view !== "lock";
  homeView.hidden = view !== "home";
  timelineView.hidden = view !== "timeline";
  folderView.hidden = view !== "folder";
  searchView.hidden = view !== "search";
  backupView.hidden = view !== "backup";
  settingsView.hidden = view !== "settings";
  trackView.hidden = view !== "track";
  trackerDetailView.hidden = view !== "tracker-detail";

  headerSearchBtn.hidden = view !== "home";

  // Bottom nav only shows for the 5 top-level tabs — search/folder/tracker-detail/lock/welcome
  // show their own back arrow (or no nav at all pre-unlock) instead, mirroring
  // android's Scaffold(bottomBar) logic in MainActivity.kt.
  const isTopLevelTab = view === "home" || view === "timeline" || view === "track" || view === "backup" || view === "settings";
  appNav.hidden = !isTopLevelTab;
  navHomeBtn.classList.toggle("active", view === "home");
  navTimelineBtn.classList.toggle("active", view === "timeline");
  navTrackBtn.classList.toggle("active", view === "track");
  navBackupBtn.classList.toggle("active", view === "backup");
  navSettingsBtn.classList.toggle("active", view === "settings");

  // "Welcome, {name}" only makes sense on Home — every other screen keeps the plain app name.
  headerAppNameEl.textContent = view === "home" ? `Welcome, ${getUserName()}` : APP_CONTENT.appName;
}

// ---------- Back navigation ----------
// Every forward navigation (open a category, drill into a folder level, open
// search, switch to a top-level tab) registers its own "go back one step"
// handler here and pushes a history entry. Hardware/gesture back (Android)
// fires popstate, which pops and runs that handler — same code path as
// tapping an on-screen back arrow (see setHeader below, which just calls
// history.back() rather than invoking the handler directly, so the two never
// drift out of sync). Reaching the bottom of the stack (Home, nothing left
// to pop) shows an Android-style "press back again to exit" prompt instead
// of silently doing nothing.
const backStack = [];
let lastBackPressAt = 0;
const backExitToast = document.getElementById("back-exit-toast");
let toastTimer = null;

function pushBack(handler) {
  backStack.push(handler);
  history.pushState({ depth: backStack.length }, "");
}

function showExitToast() {
  backExitToast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { backExitToast.hidden = true; }, 2000);
}

window.addEventListener("popstate", () => {
  const handler = backStack.pop();
  if (handler) {
    handler();
    return;
  }
  const now = Date.now();
  if (now - lastBackPressAt < 2000) return; // second press within the window — let the real exit happen
  lastBackPressAt = now;
  showExitToast();
  history.pushState({ guard: true }, ""); // re-arm so the next back press hits this listener again instead of exiting
});

/** Shared header for folder-view — used both by the flat-category path below and by folder.js's nested browsing. [categoryKey] colors the banner and picks its icon (see js/theme.js); [subtitleText] is a plain-text subtitle (course-detail meta sets richer HTML into folderMetaEl itself afterward instead). The visible back arrow always just calls history.back() — the actual "go to previous screen" logic lives in whatever handler the caller pushed via pushBack, so on-screen taps and hardware/gesture back can never drift apart. */
function setHeader(title, onBack, categoryKey, subtitleText) {
  folderTitleEl.textContent = title;
  folderMetaEl.textContent = subtitleText ?? "";
  folderBackBtn.hidden = !onBack;
  folderBackBtn.onclick = onBack ? () => history.back() : null;
  if (categoryKey) {
    folderBannerEl.style.background = categoryAccent(categoryKey);
    folderBannerIconEl.textContent = categoryEmoji(categoryKey);
  }
}

// ---------- Theme (light/dark) ----------

const THEME_STORAGE_KEY = "offrs_theme";

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll("#theme-toggle button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.themeChoice === theme);
  });
}

function initTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(saved === "dark" ? "dark" : "light");
  document.querySelectorAll("#theme-toggle button").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.themeChoice;
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      applyTheme(theme);
    });
  });
}

// ---------- Settings (was "About") ----------

function renderSettings() {
  document.getElementById("settings-app-name").textContent = APP_CONTENT.appName;
  document.getElementById("about-tagline").textContent = APP_CONTENT.tagline;
  document.getElementById("why-text").textContent = APP_CONTENT.whyThisApp;
  document.getElementById("howto-text").textContent = APP_CONTENT.howToUse;
  document.getElementById("about-text").textContent = APP_CONTENT.about;
  document.getElementById("disclaimer-text").textContent = APP_CONTENT.disclaimer;
  document.getElementById("privacy-text").textContent = APP_CONTENT.privacy;
  document.getElementById("about-credit").textContent = APP_CONTENT.credit;

  document.querySelectorAll(".info-card").forEach((card) => {
    const body = document.getElementById(card.dataset.expandTarget);
    card.querySelector(".info-card-head").addEventListener("click", () => {
      const expanded = card.classList.toggle("expanded");
      body.hidden = !expanded;
    });
  });
}

// ---------- Lock screen ----------

function switchLockBox(which) {
  pinEntryBox.hidden = which !== "pin";
  recoverySetupBox.hidden = which !== "recovery-setup";
  forgotPinBox.hidden = which !== "forgot-pin";
}

function maskPhone(phone) {
  if (phone.length < 4) return phone;
  return "•".repeat(phone.length - 4) + phone.slice(-4);
}

function maskEmail(email) {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const maskedUser = user.length <= 2 ? user[0] + "•" : user[0] + "•".repeat(user.length - 2) + user.slice(-1);
  return `${maskedUser}@${domain}`;
}

function wireSaveNewPinHandler() {
  document.getElementById("forgot-save-new-pin").onclick = async () => {
    const newPinInput = document.getElementById("forgot-new-pin");
    const statusEl = document.getElementById("forgot-status");
    if (newPinInput.value.length < 4) { statusEl.textContent = "PIN must be at least 4 digits"; return; }
    await setPin(db, newPinInput.value);
    await unlock();
  };
}

async function initLockScreen() {
  switchLockBox("pin");

  const pinAlreadySet = await isPinSet(db);
  const title = document.getElementById("lock-title");
  const pinField = document.getElementById("lock-pin");
  const confirmField = document.getElementById("lock-pin-confirm");
  const errorEl = document.getElementById("lock-error");
  const submitBtn = document.getElementById("lock-submit");
  const biometricBtn = document.getElementById("lock-biometric");
  const forgotBtn = document.getElementById("lock-forgot");

  title.textContent = pinAlreadySet ? "Enter PIN" : "Set a PIN";
  confirmField.hidden = pinAlreadySet;
  submitBtn.textContent = pinAlreadySet ? "Unlock" : "Set PIN";

  const canPlatformAuth = pinAlreadySet && (await platformAuthAvailable());
  const platformAuthAlreadyRegistered = canPlatformAuth && (await platformAuthRegistered(db));
  biometricBtn.hidden = !canPlatformAuth;
  biometricBtn.textContent = platformAuthAlreadyRegistered ? "Use Face/Touch ID" : "Enable Face/Touch ID";

  const recoveryContact = pinAlreadySet ? await getRecoveryContact(db) : null;
  forgotBtn.hidden = !(recoveryContact?.phone || recoveryContact?.email);
  forgotBtn.onclick = () => showForgotPinFlow(recoveryContact);

  const showError = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; };
  const clearError = () => { errorEl.hidden = true; };

  submitBtn.onclick = async () => {
    clearError();
    const pin = pinField.value;
    if (!pinAlreadySet) {
      if (pin.length < 4) return showError("PIN must be at least 4 digits");
      if (pin !== confirmField.value) return showError("PINs don't match");
      await setPin(db, pin);
      showRecoverySetupFlow(); // optional — offered once, right after first-time PIN set
    } else {
      if (await verifyPin(db, pin)) {
        await unlock();
      } else {
        showError("Wrong PIN");
      }
    }
  };

  // Neither field sits inside a <form>, so Enter does nothing by default —
  // wire it to behave like tapping Unlock/Set PIN, and blur (dismisses the
  // on-screen keyboard) either way.
  const onPinFieldEnter = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.target.blur();
    submitBtn.click();
  };
  pinField.onkeydown = onPinFieldEnter;
  confirmField.onkeydown = onPinFieldEnter;

  biometricBtn.onclick = async () => {
    clearError();
    if (!platformAuthAlreadyRegistered) {
      try {
        await registerPlatformAuth(db);
        await unlock();
      } catch {
        showError("Could not enable Face/Touch ID on this device");
      }
      return;
    }
    const ok = await unlockWithPlatformAuth(db);
    if (ok) await unlock(); else showError("Biometric failed — use PIN instead");
  };

  // Auto-prompt biometric once on load, if already set up.
  if (platformAuthAlreadyRegistered) {
    const ok = await unlockWithPlatformAuth(db);
    if (ok) await unlock();
  }
}

/** Shown once, right after first-time PIN set. Optional — Skip goes straight into the app. */
function showRecoverySetupFlow() {
  switchLockBox("recovery-setup");

  const phoneInput = document.getElementById("recovery-phone");
  const sendPhoneBtn = document.getElementById("recovery-send-phone-otp");
  const codeInput = document.getElementById("recovery-phone-code");
  const verifyPhoneBtn = document.getElementById("recovery-verify-phone-otp");
  const emailInput = document.getElementById("recovery-email");
  const sendEmailBtn = document.getElementById("recovery-send-email-link");
  const statusEl = document.getElementById("recovery-status");
  const skipBtn = document.getElementById("recovery-skip");

  sendPhoneBtn.hidden = false;
  codeInput.hidden = true;
  verifyPhoneBtn.hidden = true;
  phoneInput.value = "";
  codeInput.value = "";
  emailInput.value = "";
  statusEl.textContent = "";

  sendPhoneBtn.onclick = async () => {
    if (!phoneInput.value.trim()) return;
    statusEl.textContent = "Sending code…";
    try {
      await sendPhoneOtp(phoneInput.value.trim(), "recaptcha-container");
      sendPhoneBtn.hidden = true;
      codeInput.hidden = false;
      verifyPhoneBtn.hidden = false;
      statusEl.textContent = "";
    } catch (e) {
      statusEl.textContent = e.message || "Could not send code";
    }
  };

  verifyPhoneBtn.onclick = async () => {
    try {
      await verifyPhoneOtp(codeInput.value.trim());
      await setRecoveryContact(db, { phone: phoneInput.value.trim() });
      await unlock();
    } catch (e) {
      statusEl.textContent = e.message || "Wrong code";
    }
  };

  sendEmailBtn.onclick = async () => {
    if (!emailInput.value.trim()) return;
    statusEl.textContent = "Sending…";
    try {
      await sendEmailRecoveryLink(emailInput.value.trim());
      await setRecoveryContact(db, { email: emailInput.value.trim() });
      statusEl.textContent = "Link sent — this only registers the email; you're not blocked from continuing.";
    } catch (e) {
      statusEl.textContent = e.message || "Could not send link";
    }
  };

  skipBtn.onclick = () => unlock();
}

/** Reached via the lock screen's "Forgot PIN?" link. */
function showForgotPinFlow(contact) {
  switchLockBox("forgot-pin");

  const targetEl = document.getElementById("forgot-pin-target");
  const sendPhoneBtn = document.getElementById("forgot-send-phone-otp");
  const codeInput = document.getElementById("forgot-phone-code");
  const verifyPhoneBtn = document.getElementById("forgot-verify-phone-otp");
  const sendEmailBtn = document.getElementById("forgot-send-email-link");
  const statusEl = document.getElementById("forgot-status");
  const newPinBox = document.getElementById("forgot-new-pin-box");
  const cancelBtn = document.getElementById("forgot-cancel");

  sendPhoneBtn.hidden = true;
  codeInput.hidden = true;
  verifyPhoneBtn.hidden = true;
  sendEmailBtn.hidden = true;
  newPinBox.hidden = true;
  codeInput.value = "";
  document.getElementById("forgot-new-pin").value = "";
  statusEl.textContent = "";

  cancelBtn.onclick = () => switchLockBox("pin");
  wireSaveNewPinHandler();

  if (contact?.phone) {
    targetEl.textContent = `Reset PIN via ${maskPhone(contact.phone)}`;
    sendPhoneBtn.hidden = false;
    sendPhoneBtn.onclick = async () => {
      statusEl.textContent = "Sending code…";
      try {
        await sendPhoneOtp(contact.phone, "recaptcha-container");
        sendPhoneBtn.hidden = true;
        codeInput.hidden = false;
        verifyPhoneBtn.hidden = false;
        statusEl.textContent = "";
      } catch (e) {
        statusEl.textContent = e.message || "Could not send code";
      }
    };
    verifyPhoneBtn.onclick = async () => {
      try {
        await verifyPhoneOtp(codeInput.value.trim());
        newPinBox.hidden = false;
        statusEl.textContent = "Verified — set a new PIN.";
      } catch (e) {
        statusEl.textContent = e.message || "Wrong code";
      }
    };
  } else if (contact?.email) {
    targetEl.textContent = `Reset PIN via ${maskEmail(contact.email)}`;
    sendEmailBtn.hidden = false;
    sendEmailBtn.onclick = async () => {
      statusEl.textContent = "Sending…";
      try {
        await sendEmailRecoveryLink(contact.email);
        statusEl.textContent = "Link sent — open it on this device to continue.";
      } catch (e) {
        statusEl.textContent = e.message || "Could not send link";
      }
    };
  }
}

async function unlock() {
  fileKey = await getOrCreateKey(db);
  initFolderBrowser({ db, fileKey, showView, setHeader, contentEl: folderContentEl, metaEl: folderMetaEl, pushBack });
  initTrack({ db, showView, pushBack });
  appUnlocked = true;
  everUnlocked = true;
  showView("home");
  await renderHome();
  // Home is the base of the in-app back stack — seed one history entry here
  // so the very first hardware/gesture back press lands on our popstate
  // listener (and shows "press back again to exit") instead of leaving the
  // page immediately.
  history.pushState({ guard: true }, "");

  // "Something's due" dot on the Track tab — a ledger reminder or a
  // checklist re-check, both purely date-driven and computed locally. This
  // app stays fully offline, so a reminder only surfaces when the app is
  // actually open (no push — see README's Keep Track section for why).
  const badgeDot = document.getElementById("track-badge-dot");
  async function refreshTrackBadge() { badgeDot.hidden = !(await anyTrackReminderDue()); }
  refreshTrackBadge();
  setInterval(refreshTrackBadge, 60_000);
}

// Shared "away too long" threshold — both the backgrounding re-lock below and
// the in-foreground idle-timeout further down use this same value, so there's
// one consistent rule for either kind of absence.
const IDLE_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

// Backgrounding the app/tab for a while (switch app, lock phone, minimize)
// clears appUnlocked; coming back re-shows the lock screen instead of
// resuming wherever the user was — without this, "unlocked" only ever lived
// in a JS variable for the life of the page, so switching away and back
// (phone still unlocked, PWA still open) skipped PIN/biometric entirely no
// matter how long it sat hidden. Gated by everUnlocked so this never fires
// before the very first unlock completes.
//
// Only a real absence re-locks, not a quick switch-away-and-back (e.g.
// checking WhatsApp for a second) — relocking on every single tab-hide was
// reported as "very annoying."
let hiddenAt = null;
document.addEventListener("visibilitychange", () => {
  if (!everUnlocked) return;
  if (document.visibilityState === "hidden") {
    hiddenAt = Date.now();
  } else if (document.visibilityState === "visible") {
    const wasHiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = null;
    if (wasHiddenFor >= IDLE_LOCK_TIMEOUT_MS) appUnlocked = false;
    if (!appUnlocked) {
      showView("lock");
      initLockScreen();
    }
  }
});

// ---------- Idle-timeout auto-lock ----------
// Protects against "left the phone/laptop unlocked with the tab open," which
// the visibilitychange re-lock above doesn't catch (tab can stay fully
// visible and foregrounded indefinitely). Any pointer/key activity resets the
// clock; a periodic check re-locks the same way the backgrounding path does.

let lastInteractionAt = Date.now();

["pointerdown", "keydown"].forEach((eventName) => {
  document.addEventListener(eventName, () => { lastInteractionAt = Date.now(); }, { passive: true });
});

setInterval(() => {
  if (!everUnlocked || !appUnlocked) return;
  if (Date.now() - lastInteractionAt >= IDLE_LOCK_TIMEOUT_MS) {
    appUnlocked = false;
    showView("lock");
    initLockScreen();
  }
}, 15_000);

// ---------- Tap-anywhere-to-dismiss-keyboard ----------
// One global listener instead of wiring every individual form — a tap
// lands on an actual input/textarea/select (or a label pointing at one) and
// leaves it focused; a tap anywhere else blurs whatever currently has focus,
// same as tapping outside a text field on iOS/Android. Covers every screen
// with an input, not just the ones that had their own handler before this.
document.addEventListener("click", (e) => {
  const active = document.activeElement;
  if (!active || active === document.body) return;
  const isFieldTarget = e.target.closest("input, textarea, select, label, button");
  if (!isFieldTarget) active.blur();
});

// ---------- Home / categories ----------

async function renderHome() {
  const categories = await getAllCategories(db);
  categoriesById = Object.fromEntries(categories.map((c) => [c.id, c]));
  quickAddCategories = categories;
  const docCounts = await getDocCountsByCategory(db);
  const totalDocs = Object.values(docCounts).reduce((sum, n) => sum + n, 0);

  renderStatRow(categories.length, totalDocs);

  const grid = document.getElementById("category-grid");
  grid.innerHTML = "";
  for (const cat of categories) {
    const accent = categoryAccent(cat.key);
    const count = docCounts[cat.id] ?? 0;

    const tile = document.createElement("button");
    tile.className = "category-tile";

    const badge = document.createElement("span");
    badge.className = "icon-badge";
    badge.style.background = `${accent}22`;
    badge.textContent = categoryEmoji(cat.key);
    tile.appendChild(badge);

    const label = document.createElement("span");
    label.className = "tile-label";
    label.textContent = cat.displayName;
    tile.appendChild(label);

    const countEl = document.createElement("span");
    countEl.className = "doc-count";
    countEl.textContent = count === 1 ? "1 doc" : `${count} docs`;
    tile.appendChild(countEl);

    tile.addEventListener("click", () => openCategory(cat));
    grid.appendChild(tile);
  }

  renderAddCategoryTile(categories);
}

function renderAddCategoryTile(categories) {
  const wrap = document.getElementById("add-category-form-container");
  wrap.innerHTML = "";

  const addBtn = document.createElement("button");
  addBtn.className = "folder-add-btn";
  addBtn.textContent = "+ Add category";

  const form = document.createElement("div");
  form.className = "course-form";
  form.hidden = true;
  form.innerHTML = `<input id="new-category-name" placeholder="Category name" /><button id="new-category-save">Save</button><button type="button" id="new-category-cancel" class="secondary-btn">Cancel</button>`;

  function resetForm() {
    form.querySelector("#new-category-name").value = "";
    form.hidden = true;
    addBtn.hidden = false;
  }
  addBtn.addEventListener("click", () => { form.hidden = false; addBtn.hidden = true; form.querySelector("#new-category-name").focus(); });
  // No way to back out once tapped was a real gap — Cancel just re-collapses
  // to the "+ Add category" tile with nothing saved.
  form.querySelector("#new-category-cancel").addEventListener("click", resetForm);
  form.querySelector("#new-category-save").addEventListener("click", async () => {
    const nameInput = form.querySelector("#new-category-name");
    const name = nameInput.value.trim();
    if (!name) return;

    await createCategory(db, {
      key: slugifyCategoryName(name, categories.map((c) => c.key)),
      displayName: name,
      isUserAdded: true,
      sortOrder: categories.length,
    });
    await renderHome();
    // Visible proof it actually saved — scroll straight to the new tile
    // instead of leaving the user to wonder whether anything happened.
    document.querySelector(".category-grid .category-tile:last-of-type")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  wrap.append(addBtn, form);
}

// ---------- Quick Add ----------
// "Reach any docu's designated place, fast" — search-and-jump across every
// category instead of scrolling the Home grid. Flat categories land straight
// in their upload form (openCategory); structured ones (IPFT, Course/Cadre,
// ...) land on their own first picker, same as tapping their Home tile.

let quickAddCategories = [];

document.getElementById("quick-add-fab").addEventListener("click", () => {
  const overlay = document.getElementById("quick-add-overlay");
  const search = document.getElementById("quick-add-search");
  overlay.hidden = false;
  search.value = "";
  search.focus();
  renderQuickAddResults("");
});
document.getElementById("quick-add-cancel").addEventListener("click", () => {
  document.getElementById("quick-add-overlay").hidden = true;
});
document.getElementById("quick-add-search").addEventListener("input", (e) => renderQuickAddResults(e.target.value));

function renderQuickAddResults(query) {
  const list = document.getElementById("quick-add-results");
  list.innerHTML = "";
  const needle = query.trim().toLowerCase();

  const addNewLi = document.createElement("li");
  const addNewBtn = document.createElement("button");
  addNewBtn.textContent = "➕  Add new category";
  addNewBtn.addEventListener("click", () => {
    document.getElementById("quick-add-overlay").hidden = true;
    // Reuse Home's own "+ Add category" form — reveal it and bring it into
    // view instead of duplicating that flow here.
    document.getElementById("add-category-form-container").querySelector(".folder-add-btn")?.click();
    document.getElementById("new-category-name")?.scrollIntoView({ block: "center" });
    document.getElementById("new-category-name")?.focus();
  });
  addNewLi.appendChild(addNewBtn);
  list.appendChild(addNewLi);

  const matches = needle ? quickAddCategories.filter((c) => c.displayName.toLowerCase().includes(needle)) : quickAddCategories;
  matches.forEach((category) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = `${categoryEmoji(category.key)}  ${category.displayName}`;
    btn.addEventListener("click", () => {
      document.getElementById("quick-add-overlay").hidden = true;
      openCategory(category);
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function renderStatRow(categoryCount, docCount) {
  const row = document.getElementById("stat-row");
  row.innerHTML = "";
  const stats = [
    { icon: "🗂️", value: String(categoryCount), label: "Categories" },
    { icon: "📄", value: String(docCount), label: "Docus" },
    { icon: "☁️", value: "100%", label: "Offline" },
  ];
  for (const stat of stats) {
    const chip = document.createElement("div");
    chip.className = "stat-chip";
    chip.innerHTML = `<div class="stat-icon">${stat.icon}</div><span class="stat-value">${stat.value}</span><div class="stat-label">${stat.label}</div>`;
    row.appendChild(chip);
  }
}

// ---------- Search ----------

const searchInput = document.getElementById("search-input");
const searchResultsEl = document.getElementById("search-results");

function renderSearchHint(icon, title, body) {
  // body may echo the user's own query — build with textContent, not
  // innerHTML, so a search string can never be interpreted as markup.
  searchResultsEl.innerHTML = "";
  const hint = document.createElement("li");
  hint.className = "search-hint";
  const iconEl = document.createElement("span");
  iconEl.className = "search-hint-icon";
  iconEl.textContent = icon;
  const titleEl = document.createElement("strong");
  titleEl.textContent = title;
  const bodyEl = document.createElement("span");
  bodyEl.textContent = body;
  hint.append(iconEl, titleEl, bodyEl);
  searchResultsEl.appendChild(hint);
}

searchInput.addEventListener("input", async () => {
  const query = searchInput.value.trim();
  searchResultsEl.innerHTML = "";
  if (!query) {
    renderSearchHint("🔍", "Search everything", "Title, tags, CORO number, cert issuer — type above to search across every Docu.");
    return;
  }

  const results = await searchDocuments(db, query);
  if (results.length === 0) {
    renderSearchHint("🔍", "No matches", `Nothing found for "${query}". Check the spelling or try a shorter word.`);
    return;
  }
  for (const doc of results) {
    const li = document.createElement("li");

    const label = document.createElement("span");
    const categoryName = categoriesById[doc.categoryId]?.displayName ?? "";
    label.textContent = [doc.title, categoryName, doc.tags?.length ? doc.tags.join(", ") : null]
      .filter(Boolean).join(" — ");
    li.appendChild(label);

    const openBtn = document.createElement("button");
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => openDocument(fileKey, doc));
    li.appendChild(openBtn);

    const shareBtn = document.createElement("button");
    shareBtn.textContent = "Share";
    shareBtn.addEventListener("click", () => shareDocument(fileKey, doc));
    li.appendChild(shareBtn);

    searchResultsEl.appendChild(li);
  }
});

async function openCategory(category) {
  // IPFT, RET, Course/Cadre get a folder browser; everything else is a flat
  // upload/list here, via the same shared docs-panel folder.js uses.
  if (openStructuredCategory(category)) return;

  showView("folder");
  const onBack = () => showView("home");
  setHeader(category.displayName, onBack, category.key);
  pushBack(onBack);
  const extraFields = EXTRA_FIELDS_BY_CATEGORY[category.key] ?? [];
  const titleOptions = TITLE_OPTIONS_BY_CATEGORY[category.key] ?? [];
  await renderDocsPanel(folderContentEl, { db, fileKey }, category, null, { extraFields, titleOptions });
}

// ---------- Backup / Restore ----------

document.getElementById("export-btn").addEventListener("click", async () => {
  const password = document.getElementById("export-password").value;
  const statusEl = document.getElementById("export-status");
  if (!password) { statusEl.textContent = "Enter a backup password first."; return; }

  statusEl.textContent = "Exporting…";
  try {
    const json = await exportBackup(db, fileKey, password);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offrs-pers-files-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    statusEl.textContent = "Backup downloaded.";
  } catch {
    statusEl.textContent = "Export failed.";
  }
});

document.getElementById("import-btn").addEventListener("click", async () => {
  const file = document.getElementById("import-file").files[0];
  const password = document.getElementById("import-password").value;
  const statusEl = document.getElementById("import-status");
  if (!file || !password) { statusEl.textContent = "Choose a backup file and enter its password."; return; }

  statusEl.textContent = "Importing…";
  try {
    const jsonText = await file.text();
    const count = await importBackup(db, fileKey, password, jsonText);
    statusEl.textContent = `Imported ${count} Docu(s).`;
    await renderHome();
  } catch {
    statusEl.textContent = "Import failed — check the password and file.";
  }
});

navHomeBtn.addEventListener("click", () => showView("home"));
navTimelineBtn.addEventListener("click", async () => {
  showView("timeline");
  pushBack(() => showView("home"));
  await renderTimeline(document.getElementById("timeline-content"), { db, fileKey }, categoriesById, openCategory);
});
navTrackBtn.addEventListener("click", async () => {
  showView("track");
  pushBack(() => showView("home"));
  await renderTrackLedger();
});
document.getElementById("track-tab-ledger").addEventListener("click", async () => {
  document.getElementById("track-tab-ledger").classList.add("active");
  document.getElementById("track-tab-checklist").classList.remove("active");
  document.getElementById("track-ledger-content").hidden = false;
  document.getElementById("track-checklist-content").hidden = true;
  await renderTrackLedger();
});
document.getElementById("track-tab-checklist").addEventListener("click", async () => {
  document.getElementById("track-tab-checklist").classList.add("active");
  document.getElementById("track-tab-ledger").classList.remove("active");
  document.getElementById("track-checklist-content").hidden = false;
  document.getElementById("track-ledger-content").hidden = true;
  await renderTrackChecklist();
});
navBackupBtn.addEventListener("click", () => {
  showView("backup");
  pushBack(() => showView("home"));
});
navSettingsBtn.addEventListener("click", () => {
  showView("settings");
  pushBack(() => showView("home"));
});
headerSearchBtn.addEventListener("click", () => {
  showView("search");
  pushBack(() => showView("home"));
  searchInput.value = "";
  renderSearchHint("🔍", "Search everything", "Title, tags, CORO number, cert issuer — type above to search across every Docu.");
  searchInput.focus();
});
document.getElementById("search-back").addEventListener("click", () => history.back());

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js");
}

async function init() {
  document.title = APP_CONTENT.appName;
  initTheme();
  renderSettings();

  db = await openDb();
  await seedBuiltInCategories(db);
  await seedTrackingData(db);
  await migrateFlatCoroMiscToFolders(db);

  // User tapped a recovery-email link (opened this same page fresh, possibly
  // a new tab) — jump straight to "set new PIN", skipping onboarding/PIN entry.
  if (isEmailRecoveryLink()) {
    showView("lock");
    switchLockBox("forgot-pin");
    const targetEl = document.getElementById("forgot-pin-target");
    const statusEl = document.getElementById("forgot-status");
    const newPinBox = document.getElementById("forgot-new-pin-box");
    document.getElementById("forgot-cancel").onclick = () => { switchLockBox("pin"); initLockScreen(); };
    wireSaveNewPinHandler();

    targetEl.textContent = "Confirming email link…";
    try {
      const email = await completeEmailRecoveryLink();
      targetEl.textContent = `Verified via ${maskEmail(email)}`;
      newPinBox.hidden = false;
    } catch {
      const email = window.prompt("Enter the email you used to request the reset:");
      if (email) {
        try {
          const confirmedEmail = await completeEmailRecoveryLink(email);
          targetEl.textContent = `Verified via ${maskEmail(confirmedEmail)}`;
          newPinBox.hidden = false;
        } catch {
          statusEl.textContent = "Could not verify — the link may have expired.";
        }
      } else {
        statusEl.textContent = "Email required to continue.";
      }
    }
    return;
  }

  // A PIN already existing is treated as "onboarding done" too, even if that
  // flag itself is somehow unset (e.g. localStorage cleared while IndexedDB
  // — a separate store — still holds the real PIN/documents) — otherwise a
  // real user with a real PIN gets replayed the first-run Welcome slides
  // (caught live on a real device, matching the same bug fixed in the
  // Android build).
  if (!isOnboardingDone()) {
    if (await isPinSet(db)) markOnboardingDone(); // self-heal — don't re-derive this every launch
  }
  if (!isOnboardingDone()) {
    showView("welcome");
    initWelcomeScreen(() => {
      showView("name-entry");
      initNameEntryScreen(async () => {
        showView("lock");
        await initLockScreen();
      });
    });
    return;
  }

  showView("lock");
  await initLockScreen();
}

init();
