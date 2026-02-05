import { STORAGE_KEYS } from "./constants.js";
import { callButtonHtml } from "./call.js";
import { digitsOnly, isValidPhoneDigits, sanitizeTone, escapeHtml, fmtAgeMs } from "./utils.js";

const IGNORED_TITLES = new Set([
  "Driver online",
  "Driver offline",
  "Driver registered",
  "Ride update",
]);

function isImportantEntry(entry) {
  const title = String(entry?.title ?? "").trim();
  if (!title) return false;
  if (IGNORED_TITLES.has(title)) return false;
  return true;
}

export function loadActivity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.activity);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e === "object")
      .filter(isImportantEntry)
      .map((entry) => {
        const next = { ...entry };
        next.tone = sanitizeTone(next.tone);

        let phoneDigits = digitsOnly(next.phoneDigits || "");
        let detail = String(next.detail ?? "");

        if (!phoneDigits) {
          const parts = detail
            .split("•")
            .map((p) => String(p).trim())
            .filter(Boolean);
          const kept = [];
          for (const part of parts) {
            const digits = digitsOnly(part);
            if (!phoneDigits && isValidPhoneDigits(digits)) {
              phoneDigits = digits;
              continue;
            }
            kept.push(part);
          }
          detail = kept.join(" • ");
        }

        next.phoneDigits = phoneDigits;
        next.detail = detail;
        next.callLabel = String(next.callLabel ?? "").slice(0, 80);
        return next;
      })
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function saveActivity(state) {
  try {
    localStorage.setItem(STORAGE_KEYS.activity, JSON.stringify(state.activity.slice(0, 100)));
  } catch {
    // ignore
  }
}

export function clearActivity(state, els) {
  state.activity = [];
  try {
    localStorage.removeItem(STORAGE_KEYS.activity);
  } catch {
    // ignore
  }
  if (state.ui?.activeTab === "activity") renderActivity(state, els);
}

export function addActivity(state, els, title, detail, tone = "info", meta = {}) {
  if (IGNORED_TITLES.has(String(title ?? "").trim())) return;
  const entry = {
    id: typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : String(Date.now()),
    at: Date.now(),
    title: String(title ?? "").slice(0, 80),
    detail: String(detail ?? "").slice(0, 160),
    tone: sanitizeTone(tone),
    phoneDigits: digitsOnly(meta?.phoneDigits ?? meta?.phone ?? ""),
    callLabel: String(meta?.callLabel ?? "").slice(0, 80),
  };
  state.activity.unshift(entry);
  state.activity = state.activity.slice(0, 60);
  saveActivity(state);
  if (state.ui?.activeTab === "activity") renderActivity(state, els);
}

function formatWhen(ts) {
  const age = fmtAgeMs(Date.now() - Number(ts || 0));
  try {
    const t = new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return `${age} • ${t}`;
  } catch {
    return age;
  }
}

function toneIconSvg(tone) {
  const t = sanitizeTone(tone);
  if (t === "success") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 16.6 4.9 12.3a1 1 0 1 1 1.4-1.4l2.9 2.9 8-8a1 1 0 0 1 1.4 1.4l-8.7 8.7a1 1 0 0 1-1.4 0z"/></svg>`;
  }
  if (t === "warning") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm0 12a1 1 0 0 1-1-1V7a1 1 0 1 1 2 0v6a1 1 0 0 1-1 1zm0 4a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 12 18z"/></svg>`;
  }
  if (t === "danger") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm3.7 13.3a1 1 0 0 1-1.4 1.4L12 13.4l-2.3 2.3a1 1 0 1 1-1.4-1.4L10.6 12 8.3 9.7a1 1 0 0 1 1.4-1.4L12 10.6l2.3-2.3a1 1 0 0 1 1.4 1.4L13.4 12l2.3 2.3z"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2zm1 15a1 1 0 1 1-2 0v-6a1 1 0 1 1 2 0v6zm-1-10.5a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5z"/></svg>`;
}

export function renderActivity(state, els) {
  if (!els.activityList || !els.activityEmpty) return;
  els.activityList.innerHTML = "";

  const items = (Array.isArray(state.activity) ? state.activity : []).filter(isImportantEntry);
  for (const entry of items) {
    const el = document.createElement("div");
    el.className = `item item--activity item--${sanitizeTone(entry.tone)}`;
    const title = escapeHtml(entry.title || "");
    const detail = escapeHtml(entry.detail || "");
    const when = escapeHtml(formatWhen(entry.at));
    const phoneDigits = digitsOnly(entry.phoneDigits || "");
    const callLabel =
      String(entry.callLabel || "").trim() || (detail ? `Call ${entry.detail}` : "Call");
    const call = phoneDigits ? callButtonHtml(phoneDigits, callLabel) : "";
    const icon = toneIconSvg(entry.tone);
    el.innerHTML = `
      <div class="activityRow">
        <div class="activityIcon" aria-hidden="true">${icon}</div>
        <div class="activityMain">
          <div class="activityTop">
            <div class="activityTitle">
              <span class="activityTitle__text">${title}</span>
              <span class="activityTitle__when">${when}</span>
            </div>
            ${call ? `<div class="activityCall">${call}</div>` : ""}
          </div>
          ${detail ? `<div class="activityDetail">${detail}</div>` : ""}
        </div>
      </div>
    `;
    els.activityList.appendChild(el);
  }

  els.activityEmpty.hidden = items.length > 0;
}
