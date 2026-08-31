// First-run welcome flow — shown once (localStorage flag), before the lock
// screen ever appears. Mirrors android's WelcomeScreen.kt.

const SLIDES = [
  {
    title: "Welcome to Offrs' Pers Files",
    body: "Keep every career Docu safe, organized, and always with you.",
  },
  {
    title: "Organize by category",
    body: "CORO, IPFT, RET, Courses, Certificates and more — built for how you already file paperwork.",
  },
  {
    title: "Search & share instantly",
    body: "Find any Docu in seconds. Share straight to WhatsApp or any app.",
  },
  {
    title: "100% offline, 100% yours",
    body: "No account required, no cloud, no tracking. Everything stays encrypted on this device — only you hold the key.",
  },
];

const STORAGE_KEY = "offrs_onboarding_done";

export function isOnboardingDone() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true; // storage blocked — don't trap the user on the welcome screen forever
  }
}

export function markOnboardingDone() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore — worst case the welcome flow reappears next load
  }
}

const NAME_STORAGE_KEY = "offrs_user_name";

/** Powers the "Welcome, {name}" greeting on Home — asked once, right after the Welcome slides. */
export function getUserName() {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) || "Officer";
  } catch {
    return "Officer";
  }
}

function setUserName(name) {
  try {
    if (name.trim()) localStorage.setItem(NAME_STORAGE_KEY, name.trim());
  } catch {
    // ignore — worst case the greeting stays generic
  }
}

/** Shown once, right after the Welcome slides — skippable, defaults to "Officer". */
export function initNameEntryScreen(onDone) {
  const input = document.getElementById("name-entry-input");
  const continueBtn = document.getElementById("name-entry-continue");
  const skipBtn = document.getElementById("name-entry-skip");
  input.value = "";

  continueBtn.onclick = () => {
    setUserName(input.value);
    onDone();
  };
  skipBtn.onclick = () => onDone();

  // Not inside a <form>, so Enter does nothing by default — wire it to
  // behave like tapping Continue (or just dismiss the keyboard if blank).
  input.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    input.blur();
    if (input.value.trim()) continueBtn.click();
  };
}

export function initWelcomeScreen(onDone) {
  let index = 0;
  const titleEl = document.getElementById("welcome-title");
  const bodyEl = document.getElementById("welcome-body");
  const nextBtn = document.getElementById("welcome-next");

  function render() {
    titleEl.textContent = SLIDES[index].title;
    bodyEl.textContent = SLIDES[index].body;
    nextBtn.textContent = index === SLIDES.length - 1 ? "Get Started" : "Next";
  }

  nextBtn.onclick = () => {
    if (index < SLIDES.length - 1) {
      index++;
      render();
    } else {
      markOnboardingDone();
      onDone();
    }
  };

  render();
}
