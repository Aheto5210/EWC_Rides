import { STORAGE_KEYS } from "./constants.js";

export function normalizeTheme(theme) {
  return theme === "light" ? "light" : "dark";
}

export function getSystemTheme() {
  try {
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

export function getInitialTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  if (saved === "light" || saved === "dark") return saved;
  return getSystemTheme();
}

export function applyTheme(theme, els, { persist = false } = {}) {
  const next = normalizeTheme(theme);
  document.documentElement.dataset.theme = next;
  if (persist) localStorage.setItem(STORAGE_KEYS.theme, next);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "dark" ? "#0b0b0c" : "#f5f5f8");

  if (els?.btnTheme) {
    const label = next === "dark" ? "Switch to light mode" : "Switch to dark mode";
    els.btnTheme.setAttribute("aria-label", label);
    els.btnTheme.title = label;
    els.btnTheme.textContent = next === "dark" ? "☀︎" : "☾";
  }

  return next;
}

export function initTheme({ state, els }) {
  const initial = getInitialTheme();
  const applied = applyTheme(initial, els, { persist: false });
  if (state?.ui) state.ui.theme = applied;

  // Follow system theme unless the user explicitly picked one.
  try {
    const media = window.matchMedia?.("(prefers-color-scheme: light)") ?? null;
    if (state?.ui) state.ui.themeMedia = media;
    const hasSaved = localStorage.getItem(STORAGE_KEYS.theme) != null;
    if (media && !hasSaved) {
      const onChange = () => {
        const stillNoSaved = localStorage.getItem(STORAGE_KEYS.theme) == null;
        if (!stillNoSaved) return;
        const next = media.matches ? "light" : "dark";
        const appliedNext = applyTheme(next, els, { persist: false });
        if (state?.ui) state.ui.theme = appliedNext;
      };
      if (typeof media.addEventListener === "function") {
        media.addEventListener("change", onChange);
      } else if (typeof media.addListener === "function") {
        media.addListener(onChange);
      }
    }
  } catch {
    // ignore
  }

  if (!els?.btnTheme) return;

  // Tap: toggle light/dark (persists). Press & hold: revert to system theme.
  let holdTimer = null;
  let held = false;

  const clearHold = () => {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
  };

  const onHold = () => {
    held = true;
    localStorage.removeItem(STORAGE_KEYS.theme);
    const next = getSystemTheme();
    const appliedNext = applyTheme(next, els, { persist: false });
    if (state?.ui) state.ui.theme = appliedNext;
  };

  els.btnTheme.addEventListener("pointerdown", () => {
    held = false;
    clearHold();
    holdTimer = setTimeout(onHold, 520);
  });
  els.btnTheme.addEventListener("pointerup", clearHold);
  els.btnTheme.addEventListener("pointercancel", clearHold);
  els.btnTheme.addEventListener("contextmenu", (e) => e.preventDefault());

  els.btnTheme.addEventListener("click", () => {
    if (held) return;
    const current = normalizeTheme(document.documentElement.dataset.theme);
    const next = current === "dark" ? "light" : "dark";
    const appliedNext = applyTheme(next, els, { persist: true });
    if (state?.ui) state.ui.theme = appliedNext;
  });
}

