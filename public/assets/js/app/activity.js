import { STORAGE_KEYS } from "./constants.js";
import { callButtonHtml } from "./call.js";
import { digitsOnly, isValidPhoneDigits, sanitizeTone, escapeHtml } from "./utils.js";

export function loadActivity() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.activity);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e === "object")
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

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function renderActivity(state, els) {
  if (!els.activityList || !els.activityEmpty) return;
  els.activityList.innerHTML = "";

  const items = Array.isArray(state.activity) ? state.activity : [];
  for (const entry of items) {
    const el = document.createElement("div");
    el.className = `item item--activity item--${sanitizeTone(entry.tone)}`;
    const title = escapeHtml(entry.title || "");
    const detail = escapeHtml(entry.detail || "");
    const when = escapeHtml(formatTime(entry.at));
    const phoneDigits = digitsOnly(entry.phoneDigits || "");
    const callLabel =
      String(entry.callLabel || "").trim() || (detail ? `Call ${entry.detail}` : "Call");
    const call = phoneDigits ? callButtonHtml(phoneDigits, callLabel) : "";
    el.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">${title}</div>
          ${detail ? `<div class="item__meta">${detail}</div>` : ""}
        </div>
        <div class="item__side">
          ${call}
          <div class="item__meta">${when}</div>
        </div>
      </div>
    `;
    els.activityList.appendChild(el);
  }

  els.activityEmpty.hidden = items.length > 0;
}

