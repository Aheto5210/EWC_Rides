const STORAGE_KEYS = {
  deviceId: "ewc.deviceId",
  role: "ewc.role",
  room: "ewc.room",
  roomCode: "ewc.roomCode",
  theme: "ewc.theme",
  riderName: "ewc.rider.name",
  riderPhone: "ewc.rider.phone",
  driverName: "ewc.driver.name",
  driverPhone: "ewc.driver.phone",
  riderRequestId: "ewc.rider.requestId",
  activity: "ewc.activity",
};

const els = {
  tabHome: document.getElementById("tabHome"),
  tabActivity: document.getElementById("tabActivity"),
  btnTheme: document.getElementById("btnTheme"),
  homeView: document.getElementById("homeView"),
  activityView: document.getElementById("activityView"),
  activityList: document.getElementById("activityList"),
  activityEmpty: document.getElementById("activityEmpty"),
  btnClearActivity: document.getElementById("btnClearActivity"),
  locationCard: document.getElementById("locationCard"),
  locationText: document.getElementById("locationText"),
  btnEnableLocation: document.getElementById("btnEnableLocation"),
  roleCard: document.getElementById("roleCard"),
  btnRoleDriver: document.getElementById("btnRoleDriver"),
  btnRoleRider: document.getElementById("btnRoleRider"),
  daysHint: document.getElementById("daysHint"),
  driverCard: document.getElementById("driverCard"),
  btnSwitchToRider: document.getElementById("btnSwitchToRider"),
  driverStatePill: document.getElementById("driverStatePill"),
  btnDriverToggle: document.getElementById("btnDriverToggle"),
  driverRequests: document.getElementById("driverRequests"),
  driverRequestsEmpty: document.getElementById("driverRequestsEmpty"),
  riderCard: document.getElementById("riderCard"),
  btnSwitchToDriver: document.getElementById("btnSwitchToDriver"),
  riderActive: document.getElementById("riderActive"),
  btnCancelRequest: document.getElementById("btnCancelRequest"),
  driversSectionTitle: document.getElementById("driversSectionTitle"),
  driversList: document.getElementById("driversList"),
  driversEmpty: document.getElementById("driversEmpty"),
  btnReset: document.getElementById("btnReset"),
  sheet: document.getElementById("sheet"),
  sheetOverlay: document.getElementById("sheetOverlay"),
  sheetTitle: document.getElementById("sheetTitle"),
  sheetBody: document.getElementById("sheetBody"),
  sheetError: document.getElementById("sheetError"),
  sheetClose: document.getElementById("sheetClose"),
  sheetCancel: document.getElementById("sheetCancel"),
  sheetConfirm: document.getElementById("sheetConfirm"),
};

function getOrCreateDeviceId() {
  const existing = localStorage.getItem(STORAGE_KEYS.deviceId);
  if (existing) return existing;
  const id =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `dev_${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(STORAGE_KEYS.deviceId, id);
  return id;
}

function sanitizeRoom(room) {
  const trimmed = (room ?? "").toString().trim().toLowerCase();
  if (!trimmed) return "ewc";
  return trimmed.replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "ewc";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function isValidPhoneDigits(digits) {
  return typeof digits === "string" && digits.length >= 7;
}

function sanitizeTone(tone) {
  const t = String(tone ?? "").toLowerCase();
  if (t === "success" || t === "warning" || t === "danger" || t === "info") return t;
  return "info";
}

function normalizeTheme(theme) {
  return theme === "light" ? "light" : "dark";
}

function getSystemTheme() {
  try {
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

function getInitialTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  if (saved === "light" || saved === "dark") return saved;
  return getSystemTheme();
}

function applyTheme(theme, { persist = false } = {}) {
  const next = normalizeTheme(theme);
  document.documentElement.dataset.theme = next;
  if (persist) localStorage.setItem(STORAGE_KEYS.theme, next);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", next === "dark" ? "#0b0b0c" : "#f5f5f8");

  if (els.btnTheme) {
    const label = next === "dark" ? "Switch to light mode" : "Switch to dark mode";
    els.btnTheme.setAttribute("aria-label", label);
    els.btnTheme.title = label;
    els.btnTheme.textContent = next === "dark" ? "☀︎" : "☾";
  }
}

function formatPhoneDigits(digits) {
  const d = digitsOnly(digits);
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 11 && d.startsWith("1")) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return d;
}

function telHref(digits) {
  const d = digitsOnly(digits);
  return d ? `tel:${d}` : "#";
}

const CALL_ICON_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.07 21 3 13.93 3 5c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
  </svg>
`;

function callButtonHtml(phoneDigits, label) {
  const digits = digitsOnly(phoneDigits);
  if (!digits) return "";
  const text = String(label ?? "Call").trim() || "Call";
  const safeLabel = escapeHtml(text);
  return `<a class="callBtn callBtn--online" href="${escapeHtml(
    telHref(digits),
  )}" aria-label="${safeLabel}" title="${safeLabel}">${CALL_ICON_SVG}<span class="callBtn__text">Call</span></a>`;
}

function shortId(id) {
  const clean = String(id ?? "").replaceAll("-", "");
  return clean.slice(0, 4).toUpperCase() || "EWC";
}

function driverDisplayName(deviceId) {
  return `Car ${shortId(deviceId)}`;
}

function riderDisplayName(deviceId) {
  return `Member ${shortId(deviceId)}`;
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function kmToMi(km) {
  return km * 0.621371;
}

function fmtDistanceMi(mi) {
  if (!Number.isFinite(mi)) return "—";
  if (mi < 0.1) return "< 0.1 mi";
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

function fmtAgeMs(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

function etaMinutesFromKm(km, speedKmh) {
  const s = Number(speedKmh);
  if (!Number.isFinite(km) || !Number.isFinite(s) || s <= 0) return Infinity;
  return (km / s) * 60;
}

function fmtEtaMinutes(min) {
  if (!Number.isFinite(min)) return "—";
  if (min < 1) return "< 1 min";
  return `~${Math.round(min)} min`;
}

function mapsDirectionsUrl({ originLat, originLng, destLat, destLng }) {
  const base = "https://www.google.com/maps/dir/?api=1";
  const dest = `destination=${encodeURIComponent(`${destLat},${destLng}`)}`;
  const origin =
    Number.isFinite(originLat) && Number.isFinite(originLng)
      ? `&origin=${encodeURIComponent(`${originLat},${originLng}`)}`
      : "";
  return `${base}&${dest}${origin}&travelmode=driving`;
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { "content-type": "application/json" };
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data && data.error) || res.statusText;
    const e = new Error(err);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

function setSheetError(msg) {
  els.sheetError.hidden = !msg;
  els.sheetError.textContent = msg || "";
}

function openSheet({ title, body, confirmText }) {
  els.sheetTitle.textContent = title || "";
  els.sheetBody.innerHTML = "";
  if (body) els.sheetBody.appendChild(body);
  els.sheetConfirm.textContent = confirmText || "Continue";
  els.sheetConfirm.disabled = false;
  setSheetError("");

  state.sheet.open = true;
  els.sheet.hidden = false;
  document.documentElement.style.overflow = "hidden";

  queueMicrotask(() => {
    const first =
      els.sheetBody.querySelector("input, button, textarea, select") || els.sheetConfirm;
    if (first && typeof first.focus === "function") first.focus();
  });
}

function closeSheet() {
  const onClose = state.sheet.onClose;
  state.sheet.open = false;
  state.sheet.onConfirm = null;
  state.sheet.onClose = null;
  els.sheet.hidden = true;
  setSheetError("");
  document.documentElement.style.overflow = "";
  if (typeof onClose === "function") {
    try {
      onClose();
    } catch {
      // ignore
    }
  }
}

function loadActivity() {
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

function saveActivity() {
  try {
    localStorage.setItem(STORAGE_KEYS.activity, JSON.stringify(state.activity.slice(0, 100)));
  } catch {
    // ignore
  }
}

function addActivity(title, detail, tone = "info", meta = {}) {
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
  saveActivity();
  if (state.ui?.activeTab === "activity") renderActivity();
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

function renderActivity() {
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
    const callLabel = String(entry.callLabel || "").trim() || (detail ? `Call ${entry.detail}` : "Call");
    const call = phoneDigits ? callButtonHtml(phoneDigits, callLabel) : "";
    el.innerHTML = `
      <div class="item__top">
        <div>
          <div class="item__title">${title}</div>
          ${
            detail || call
              ? `<div class="item__meta metaRow"><span>${detail}</span>${call}</div>`
              : ""
          }
        </div>
        <div class="item__meta">${when}</div>
      </div>
    `;
    els.activityList.appendChild(el);
  }

  els.activityEmpty.hidden = items.length > 0;
}

function setActiveTab(tab) {
  state.ui.activeTab = tab === "activity" ? "activity" : "home";
  els.tabHome.setAttribute(
    "aria-selected",
    state.ui.activeTab === "home" ? "true" : "false",
  );
  els.tabActivity.setAttribute(
    "aria-selected",
    state.ui.activeTab === "activity" ? "true" : "false",
  );
  els.homeView.hidden = state.ui.activeTab !== "home";
  els.activityView.hidden = state.ui.activeTab !== "activity";
  if (state.ui.activeTab === "activity") renderActivity();
}

function promptRiderContact(targetDriverName) {
  return new Promise((resolve) => {
    const body = document.createElement("div");
    const savedName = (localStorage.getItem(STORAGE_KEYS.riderName) ?? "").trim();
    const savedPhone = (localStorage.getItem(STORAGE_KEYS.riderPhone) ?? "").trim();

    body.innerHTML = `
      <div class="muted">This info will be shared with the driver you request.</div>
      <label class="field">
        <span class="field__label">Your name</span>
        <input id="sheetRiderName" class="input" autocomplete="name" placeholder="e.g., Isaac" />
      </label>
      <label class="field">
        <span class="field__label">Your phone</span>
        <input id="sheetRiderPhone" class="input" inputmode="tel" autocomplete="tel" placeholder="e.g., 4045551234" />
      </label>
    `;

    const title = targetDriverName ? `Request ${targetDriverName}` : "Request a ride";
    openSheet({ title, body, confirmText: "Send request" });

    const nameInput = body.querySelector("#sheetRiderName");
    const phoneInput = body.querySelector("#sheetRiderPhone");
    if (nameInput) nameInput.value = savedName;
    if (phoneInput) phoneInput.value = formatPhoneDigits(savedPhone);

    state.sheet.onClose = () => resolve(null);
    state.sheet.onConfirm = async () => {
      const name = (nameInput?.value ?? "").trim();
      const phoneDigits = digitsOnly(phoneInput?.value ?? "");

      if (!name) {
        setSheetError("Please enter your name.");
        nameInput?.focus();
        return;
      }
      if (!isValidPhoneDigits(phoneDigits)) {
        setSheetError("Please enter a valid phone number.");
        phoneInput?.focus();
        return;
      }

      localStorage.setItem(STORAGE_KEYS.riderName, name);
      localStorage.setItem(STORAGE_KEYS.riderPhone, phoneDigits);

      state.sheet.onClose = null;
      resolve({ name, phone: phoneDigits });
      closeSheet();
    };
  });
}

function promptDriverContact(title = "Driver details", confirmText = "Save") {
  return new Promise((resolve) => {
    const body = document.createElement("div");
    const savedName = (localStorage.getItem(STORAGE_KEYS.driverName) ?? "").trim();
    const savedPhone = (localStorage.getItem(STORAGE_KEYS.driverPhone) ?? "").trim();

    body.innerHTML = `
      <div class="muted">Share your contact so the rider can reach you.</div>
      <label class="field">
        <span class="field__label">First name</span>
        <input id="sheetDriverName" class="input" autocomplete="given-name" placeholder="e.g., John" />
      </label>
      <label class="field">
        <span class="field__label">Phone</span>
        <input id="sheetDriverPhone" class="input" inputmode="tel" autocomplete="tel" placeholder="e.g., 4045551234" />
      </label>
    `;

    openSheet({ title, body, confirmText });

    const nameInput = body.querySelector("#sheetDriverName");
    const phoneInput = body.querySelector("#sheetDriverPhone");
    if (nameInput) nameInput.value = savedName;
    if (phoneInput) phoneInput.value = formatPhoneDigits(savedPhone);

    state.sheet.onClose = () => resolve(null);
    state.sheet.onConfirm = async () => {
      const name = (nameInput?.value ?? "").trim();
      const phoneDigits = digitsOnly(phoneInput?.value ?? "");

      if (!name) {
        setSheetError("Please enter your first name.");
        nameInput?.focus();
        return;
      }
      if (!isValidPhoneDigits(phoneDigits)) {
        setSheetError("Please enter a valid phone number.");
        phoneInput?.focus();
        return;
      }

      localStorage.setItem(STORAGE_KEYS.driverName, name);
      localStorage.setItem(STORAGE_KEYS.driverPhone, phoneDigits);

      state.sheet.onClose = null;
      resolve({ name, phone: phoneDigits });
      closeSheet();
    };
  });
}

applyTheme(getInitialTheme());

const urlParams = new URLSearchParams(location.search);
const state = {
  deviceId: getOrCreateDeviceId(),
  room: sanitizeRoom(urlParams.get("room") ?? localStorage.getItem(STORAGE_KEYS.room)),
  roomCode: (urlParams.get("code") ?? localStorage.getItem(STORAGE_KEYS.roomCode) ?? "").trim(),
  role: localStorage.getItem(STORAGE_KEYS.role) || "",
  config: null,
  eventSource: null,
  ui: {
    activeTab: "home",
    theme: normalizeTheme(document.documentElement.dataset.theme),
    refreshTimer: null,
    themeMedia: null,
  },
  sheet: {
    open: false,
    onConfirm: null,
    onClose: null,
  },
  activity: loadActivity(),
  audio: {
    ctx: null,
    unlocked: false,
    lastBeepAt: 0,
    repeatTimer: null,
    sampleEl: null,
    sampleDisabled: false,
  },
  geo: {
    watchId: null,
    last: null,
    error: null,
    inFlight: false,
  },
  driver: {
    online: false,
    heartbeatTimer: null,
  },
  rider: {
    requestId: localStorage.getItem(STORAGE_KEYS.riderRequestId) || "",
    locked: false,
    assigned: null,
  },
  live: {
    drivers: new Map(),
    requests: new Map(),
  },
};

if (urlParams.get("room")) localStorage.setItem(STORAGE_KEYS.room, state.room);
if (urlParams.get("code")) localStorage.setItem(STORAGE_KEYS.roomCode, state.roomCode);

function setLocationText() {
  if (!("geolocation" in navigator)) {
    els.locationText.textContent = "Location not supported on this device.";
    els.btnEnableLocation.hidden = true;
    return;
  }

  const insecure =
    typeof window.isSecureContext === "boolean" && !window.isSecureContext;

  if (state.geo.last) {
    els.locationText.textContent = "Location ready.";
    els.btnEnableLocation.hidden = true;
    return;
  }

  if (state.geo.error) {
    els.locationText.textContent = `Location needed: ${state.geo.error}`;
    els.btnEnableLocation.hidden = false;
    return;
  }

  els.locationText.textContent =
    insecure
      ? "Tap “Allow location”. On some phones, location works only over HTTPS (see terminal)."
      : "Allow location so we can show the closest drivers.";
  els.btnEnableLocation.hidden = false;
  els.btnEnableLocation.disabled = state.geo.inFlight;
  els.btnEnableLocation.textContent = state.geo.inFlight
    ? "Requesting…"
    : "Allow location";
}

async function primeLocation() {
  if (state.geo.inFlight) return;
  if (!("geolocation" in navigator)) {
    setLocationText();
    return;
  }
  state.geo.inFlight = true;
  state.geo.error = null;
  setLocationText();
  try {
    const pos = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 12_000,
      });
    });
    const c = pos.coords;
    state.geo.last = {
      lat: c.latitude,
      lng: c.longitude,
      accuracyM: c.accuracy,
      updatedAt: Date.now(),
    };
    startGeoWatch();
    setLocationText();
    renderAll();
  } catch (e) {
    const code = Number(e?.code);
    const insecure =
      typeof window.isSecureContext === "boolean" && !window.isSecureContext;
    const httpsHint = insecure
      ? " On some phones you may need the HTTPS URL printed in your terminal."
      : "";
    const rawMessage = String(e?.message ?? "");
    const looksLikeSecureContextBlock =
      insecure &&
      /secure|origin|https|localhost/i.test(rawMessage) &&
      (code === 0 || Number.isNaN(code) || rawMessage.length > 0);
    if (!Number.isNaN(code) && code === 1) {
      state.geo.error =
        `Permission denied. Enable Location for this site in your browser settings, then try again.${httpsHint}`;
    } else if (!Number.isNaN(code) && code === 2) {
      state.geo.error = `Location unavailable. Turn on GPS and try again.${httpsHint}`;
    } else if (!Number.isNaN(code) && code === 3) {
      state.geo.error = `Timed out. Tap “Allow location” to retry.${httpsHint}`;
    } else if (looksLikeSecureContextBlock) {
      state.geo.error = `Location is blocked on this connection.${httpsHint}`;
    } else {
      state.geo.error = `${e?.message || "Could not get location."}${httpsHint}`;
    }
    setLocationText();
  } finally {
    state.geo.inFlight = false;
    setLocationText();
  }
}

function startGeoWatch() {
  if (!("geolocation" in navigator)) return;
  if (state.geo.watchId != null) return;

  state.geo.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      state.geo.last = {
        lat: c.latitude,
        lng: c.longitude,
        accuracyM: c.accuracy,
        updatedAt: Date.now(),
      };
      state.geo.error = null;
      setLocationText();
      if (state.role === "driver" && state.driver.online) {
        postDriverLocation().catch(() => {});
      }
      renderAll();
    },
    (err) => {
      const code = Number(err?.code);
      const insecure =
        typeof window.isSecureContext === "boolean" && !window.isSecureContext;
      const httpsHint = insecure
        ? " On some phones you may need the HTTPS URL printed in your terminal."
        : "";
      const rawMessage = String(err?.message ?? "");
      const looksLikeSecureContextBlock =
        insecure && /secure|origin|https|localhost/i.test(rawMessage);
      if (!Number.isNaN(code) && code === 1) {
        state.geo.error = `Permission denied. Enable Location for this site.${httpsHint}`;
      } else if (!Number.isNaN(code) && code === 2) {
        state.geo.error = `Location unavailable. Turn on GPS.${httpsHint}`;
      } else if (!Number.isNaN(code) && code === 3) {
        state.geo.error = `Timed out. Tap “Enable location” to retry.${httpsHint}`;
      } else if (looksLikeSecureContextBlock) {
        state.geo.error = `Location is blocked on this connection.${httpsHint}`;
      } else {
        state.geo.error = `${err?.message || "Could not get location."}${httpsHint}`;
      }
      setLocationText();
      renderAll();
    },
    { enableHighAccuracy: true, maximumAge: 3_000, timeout: 12_000 },
  );
}

function stopGeoWatch() {
  if (state.geo.watchId == null) return;
  navigator.geolocation.clearWatch(state.geo.watchId);
  state.geo.watchId = null;
}

function ensureAudioContext() {
  if (state.audio.ctx) return state.audio.ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  state.audio.ctx = new Ctx();
  return state.audio.ctx;
}

const NOTIFY_AUDIO_URL = "/notify.mp3";

function ensureNotificationSample() {
  if (state.audio.sampleDisabled) return null;
  if (state.audio.sampleEl) return state.audio.sampleEl;
  try {
    const audio = new Audio(NOTIFY_AUDIO_URL);
    audio.preload = "auto";
    audio.volume = 0.9;
    audio.addEventListener("error", () => {
      state.audio.sampleDisabled = true;
    });
    state.audio.sampleEl = audio;
    return audio;
  } catch {
    state.audio.sampleDisabled = true;
    return null;
  }
}

async function tryPlayNotificationSample() {
  const audio = ensureNotificationSample();
  if (!audio) return false;
  try {
    audio.currentTime = 0;
  } catch {
    // ignore
  }
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}

async function unlockAudio() {
  const ctx = ensureAudioContext();
  if (!ctx) return;
  if (ctx.state === "running") {
    state.audio.unlocked = true;
    return;
  }
  try {
    await ctx.resume();
    state.audio.unlocked = true;
  } catch {
    // ignore
  }
}

function playNotificationSound() {
  const now = Date.now();
  if (now - state.audio.lastBeepAt < 900) return;
  state.audio.lastBeepAt = now;

  tryPlayNotificationSample().then((played) => {
    if (played) return;

    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    // Fallback: "ride-style" chime (custom synth).
    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    osc1.type = "triangle";
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";

    const mix = ctx.createGain();
    mix.gain.value = 0.95;
    osc1.connect(mix);
    osc2.connect(mix);
    mix.connect(master);

    const t0 = ctx.currentTime + 0.02;
    const volume = 0.065;

    master.gain.setValueAtTime(0, t0);

    // Two rising notes.
    osc1.frequency.setValueAtTime(622.25, t0); // Eb5
    osc2.frequency.setValueAtTime(622.25, t0);
    master.gain.linearRampToValueAtTime(volume, t0 + 0.02);
    master.gain.linearRampToValueAtTime(0, t0 + 0.13);

    const t1 = t0 + 0.17;
    osc1.frequency.setValueAtTime(783.99, t1); // G5
    osc2.frequency.setValueAtTime(783.99, t1);
    master.gain.setValueAtTime(0, t1);
    master.gain.linearRampToValueAtTime(volume, t1 + 0.02);
    master.gain.linearRampToValueAtTime(0, t1 + 0.18);

    osc1.start(t0);
    osc2.start(t0);
    osc1.stop(t1 + 0.22);
    osc2.stop(t1 + 0.22);

    const cleanup = () => {
      try {
        osc1.disconnect();
        osc2.disconnect();
        mix.disconnect();
        master.disconnect();
      } catch {
        // ignore
      }
    };
    osc2.onended = cleanup;
  });
}

function hasPendingDriverRequests() {
  if (state.role !== "driver") return false;
  for (const r of state.live.requests.values()) {
    if (r.status === "pending") return true;
  }
  return false;
}

function stopRequestAlarm() {
  if (state.audio.repeatTimer) clearInterval(state.audio.repeatTimer);
  state.audio.repeatTimer = null;
}

function startRequestAlarm() {
  if (state.audio.repeatTimer) return;
  playNotificationSound();
  state.audio.repeatTimer = setInterval(() => {
    if (state.role !== "driver" || !state.driver.online || !hasPendingDriverRequests()) {
      stopRequestAlarm();
      return;
    }
    playNotificationSound();
  }, 4500);
}

function updateRequestAlarm() {
  if (state.role !== "driver" || !state.driver.online) {
    stopRequestAlarm();
    return;
  }
  if (hasPendingDriverRequests()) startRequestAlarm();
  else stopRequestAlarm();
}

async function ensureNotificationPermission() {
  if (state.role !== "driver") return false;
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const result = await Notification.requestPermission();
    return result === "granted";
  } catch {
    return false;
  }
}

async function showDriverNotification({ title, body, tag }) {
  if (state.role !== "driver") return;
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  const options = {
    body: String(body ?? ""),
    tag: tag ? String(tag) : undefined,
    renotify: true,
    icon: "/icon.svg",
    badge: "/icon.svg",
  };

  // Prefer SW notifications when available (more reliable in background).
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) {
      await reg.showNotification(String(title ?? "EWC Rides"), options);
      return;
    }
  } catch {
    // ignore
  }

  try {
    const n = new Notification(String(title ?? "EWC Rides"), options);
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore
      }
    };
  } catch {
    // ignore
  }
}

function disconnectStream() {
  if (!state.eventSource) return;
  state.eventSource.close();
  state.eventSource = null;
  stopRequestAlarm();
}

function connectStream() {
  disconnectStream();
  const role = state.role === "driver" ? "driver" : "rider";
  const params = new URLSearchParams({
    room: state.room,
    role,
    id: state.deviceId,
  });
  if (state.roomCode) params.set("code", state.roomCode);

  state.eventSource = new EventSource(`/api/stream?${params.toString()}`);

  state.eventSource.addEventListener("snapshot", (evt) => {
    const data = JSON.parse(evt.data);
    state.config = data.config;

    state.live.drivers.clear();
    for (const d of data.drivers || []) state.live.drivers.set(d.id, d);

    state.live.requests.clear();
    for (const r of data.requests || []) state.live.requests.set(r.id, r);

    // Keep rider requestId in sync if server sends it
    if (state.role === "rider") {
      const nextId = data.requests?.[0]?.id || "";
      if (nextId) {
        state.rider.requestId = nextId;
        localStorage.setItem(STORAGE_KEYS.riderRequestId, state.rider.requestId);
      } else {
        state.rider.requestId = "";
        localStorage.removeItem(STORAGE_KEYS.riderRequestId);
      }
    }

    updateRequestAlarm();
    renderAll();
  });

  state.eventSource.addEventListener("driver:update", (evt) => {
    const d = JSON.parse(evt.data);
    state.live.drivers.set(d.id, d);
    renderAll();
  });

  state.eventSource.addEventListener("driver:remove", (evt) => {
    const { id } = JSON.parse(evt.data);
    state.live.drivers.delete(id);
    renderAll();
  });

  state.eventSource.addEventListener("request:new", (evt) => {
    const r = JSON.parse(evt.data);
    const prev = state.live.requests.get(r.id);
    state.live.requests.set(r.id, r);
    if (state.role === "rider") {
      state.rider.requestId = r.id;
      localStorage.setItem(STORAGE_KEYS.riderRequestId, state.rider.requestId);
    }
    if (state.role === "driver" && !prev) {
      playNotificationSound();
      showDriverNotification({
        title: "New pickup request",
        body: `${r.name || "rider"} needs a ride`,
        tag: r.id,
      }).catch(() => {});
      addActivity("New pickup request", `${r.name || "rider"}`, "warning", {
        phoneDigits: r.riderPhone || "",
        callLabel: `Call ${r.name || "rider"}`,
      });
    }
    updateRequestAlarm();
    renderAll();
  });

  state.eventSource.addEventListener("request:update", (evt) => {
    const r = JSON.parse(evt.data);
    const prev = state.live.requests.get(r.id);
    state.live.requests.set(r.id, r);
    if (state.role === "rider") {
      state.rider.requestId = r.id;
      localStorage.setItem(STORAGE_KEYS.riderRequestId, state.rider.requestId);
      if (r.status === "assigned" && prev?.status !== "assigned") {
        state.rider.locked = true;
        state.rider.assigned = {
          name: r.assignedDriverName || "driver",
          phone: r.assignedDriverPhone || "",
        };
        state.rider.requestId = "";
        localStorage.removeItem(STORAGE_KEYS.riderRequestId);
        addActivity("Driver accepted", `${r.assignedDriverName || "driver"}`, "success", {
          phoneDigits: r.assignedDriverPhone || "",
          callLabel: `Call ${r.assignedDriverName || "driver"}`,
        });
      }
    }
    updateRequestAlarm();
    renderAll();
  });

  state.eventSource.addEventListener("request:remove", (evt) => {
    const { id, reason } = JSON.parse(evt.data);
    const prev = state.live.requests.get(id);
    state.live.requests.delete(id);
    if (state.role === "rider" && state.rider.requestId === id) {
      state.rider.requestId = "";
      localStorage.removeItem(STORAGE_KEYS.riderRequestId);
      if (reason === "expired") {
        addActivity("Request expired", "No driver response in time. Pick a driver again.", "warning");
      } else if (reason === "declined") {
        addActivity("Request declined", "Pick another driver.", "danger");
      }
    }

    if (state.role === "driver" && prev && prev.status === "pending") {
      if (reason === "cancelled") {
        addActivity(
          "Rider cancelled",
          `${prev.name || "rider"} cancelled the request.`,
          "info",
        );
      } else if (reason === "expired") {
        addActivity("Request expired", `${prev.name || "rider"} request timed out.`, "warning");
      }
    }
    updateRequestAlarm();
    renderAll();
  });
}

function showRole(role) {
  state.role = role;
  localStorage.setItem(STORAGE_KEYS.role, role);

  els.roleCard.hidden = true;
  els.driverCard.hidden = role !== "driver";
  els.riderCard.hidden = role !== "rider";

  primeLocation().catch(() => {});
  startGeoWatch();
  connectStream();
  renderAll();
}

async function clearRole() {
  if (state.role === "driver" && state.driver.online) {
    await setDriverOnline(false).catch(() => {});
  }
  state.role = "";
  localStorage.removeItem(STORAGE_KEYS.role);
  disconnectStream();
  els.roleCard.hidden = false;
  els.driverCard.hidden = true;
  els.riderCard.hidden = true;
  renderAll();
}

let lastDriverPostAt = 0;
async function postDriverLocation() {
  if (!state.geo.last) return;
  const now = Date.now();
  if (now - lastDriverPostAt < 2500) return;
  lastDriverPostAt = now;

  await api("/api/driver/update", {
    method: "POST",
    body: {
      room: state.room,
      code: state.roomCode || undefined,
      driverId: state.deviceId,
      name: driverDisplayName(state.deviceId),
      lat: state.geo.last.lat,
      lng: state.geo.last.lng,
      accuracyM: state.geo.last.accuracyM,
    },
  });
}

function stopDriverHeartbeat() {
  if (state.driver.heartbeatTimer) clearInterval(state.driver.heartbeatTimer);
  state.driver.heartbeatTimer = null;
}

function startDriverHeartbeat() {
  if (state.driver.heartbeatTimer) return;
  state.driver.heartbeatTimer = setInterval(() => {
    if (state.role !== "driver" || !state.driver.online) {
      stopDriverHeartbeat();
      return;
    }
    postDriverLocation().catch(() => {});
  }, 10_000);
}

function getSavedDriverContact() {
  const name = (localStorage.getItem(STORAGE_KEYS.driverName) ?? "").trim();
  const phone = digitsOnly(localStorage.getItem(STORAGE_KEYS.driverPhone) ?? "");
  if (!name) return null;
  if (!isValidPhoneDigits(phone)) return null;
  return { name, phone };
}

async function setDriverOnline(online) {
  if (online) {
    const saved = getSavedDriverContact();
    if (!saved) {
      const entered = await promptDriverContact("Driver details", "Save & go online");
      if (!entered) throw new Error("CANCELLED");
    }
    // Best-effort: allow lock-screen notifications for new requests.
    ensureNotificationPermission().catch(() => {});
    if (!state.geo.last) {
      await primeLocation();
    }
    if (!state.geo.last) throw new Error("LOCATION_REQUIRED");

    await api("/api/driver/start", {
      method: "POST",
      body: {
        room: state.room,
        code: state.roomCode || undefined,
        driverId: state.deviceId,
        name: driverDisplayName(state.deviceId),
      },
    });

    state.driver.online = true;
    startGeoWatch();
    await postDriverLocation().catch(() => {});
    startDriverHeartbeat();
    addActivity("Driver online", "You’re now visible to riders.", "success");
  } else {
    await api("/api/driver/stop", {
      method: "POST",
      body: {
        room: state.room,
        code: state.roomCode || undefined,
        driverId: state.deviceId,
      },
    });
    state.driver.online = false;
    stopDriverHeartbeat();
    addActivity("Driver offline", "You stopped sharing your location.", "danger");
  }
  updateRequestAlarm();
  renderAll();
}

function getActiveRiderRequest() {
  if (!state.rider.requestId) return null;
  return state.live.requests.get(state.rider.requestId) || null;
}

async function requestPickup(targetDriverId, riderContact) {
  if (state.rider.locked) throw new Error("RIDER_LOCKED");
  const existing = getActiveRiderRequest();
  if (existing) return;

  if (!state.geo.last) await primeLocation();
  if (!state.geo.last) throw new Error("LOCATION_REQUIRED");

  const riderName = (riderContact?.name ?? "").toString().trim();
  const riderPhone = digitsOnly(riderContact?.phone ?? "");
  if (!riderName) throw new Error("MISSING_RIDER_NAME");
  if (!isValidPhoneDigits(riderPhone)) throw new Error("INVALID_RIDER_PHONE");

  const result = await api("/api/ride/request", {
    method: "POST",
    body: {
      room: state.room,
      code: state.roomCode || undefined,
      riderId: state.deviceId,
      name: riderName,
      phone: riderPhone,
      lat: state.geo.last.lat,
      lng: state.geo.last.lng,
      targetDriverId,
      note: "",
    },
  });

  const req = result.request;
  state.rider.requestId = req.id;
  localStorage.setItem(STORAGE_KEYS.riderRequestId, req.id);
  state.live.requests.set(req.id, req);
  addActivity("Ride requested", `To ${req.targetDriverName || "driver"}.`, "info");
  renderAll();
}

async function cancelPickup() {
  const req = getActiveRiderRequest();
  if (!req) return;

  await api("/api/ride/cancel", {
    method: "POST",
    body: {
      room: state.room,
      code: state.roomCode || undefined,
      riderId: state.deviceId,
      requestId: req.id,
    },
  });

  state.live.requests.delete(req.id);
  state.rider.requestId = "";
  localStorage.removeItem(STORAGE_KEYS.riderRequestId);
  addActivity("Ride cancelled", "You cancelled your request.", "danger");
  renderAll();
}

function openMapsForRequest(req) {
  const origin = state.geo.last
    ? { originLat: state.geo.last.lat, originLng: state.geo.last.lng }
    : {};
  const url = mapsDirectionsUrl({ ...origin, destLat: req.lat, destLng: req.lng });
  window.open(url, "_blank", "noopener,noreferrer");
}

async function acceptRequest(req, driverContact) {
  const fallback = getSavedDriverContact();
  const driverName = (driverContact?.name ?? fallback?.name ?? "").toString().trim();
  const driverPhone = digitsOnly(driverContact?.phone ?? fallback?.phone ?? "");
  if (!driverName) throw new Error("MISSING_DRIVER_NAME");
  if (!isValidPhoneDigits(driverPhone)) throw new Error("INVALID_DRIVER_PHONE");

  const result = await api("/api/ride/accept", {
    method: "POST",
    body: {
      room: state.room,
      code: state.roomCode || undefined,
      driverId: state.deviceId,
      requestId: req.id,
      driverName,
      driverPhone,
    },
  });
  const updated = result.request;
  state.live.requests.set(updated.id, updated);
  addActivity(
    "Pickup accepted",
    `Rider: ${updated.name || "rider"}`,
    "success",
    {
      phoneDigits: updated.riderPhone || "",
      callLabel: `Call ${updated.name || "rider"}`,
    },
  );
  updateRequestAlarm();
  renderAll();
}

async function declineRequest(req) {
  await api("/api/ride/decline", {
    method: "POST",
    body: {
      room: state.room,
      code: state.roomCode || undefined,
      driverId: state.deviceId,
      requestId: req.id,
    },
  });
  state.live.requests.delete(req.id);
  addActivity(
    "Request declined",
    `Rider: ${req.name || "rider"}`,
    "danger",
    {
      phoneDigits: req.riderPhone || "",
      callLabel: `Call ${req.name || "rider"}`,
    },
  );
  updateRequestAlarm();
  renderAll();
}

async function completeRequest(req) {
  await api("/api/ride/complete", {
    method: "POST",
    body: {
      room: state.room,
      code: state.roomCode || undefined,
      driverId: state.deviceId,
      requestId: req.id,
    },
  });
  state.live.requests.delete(req.id);
  addActivity("Pickup completed", `Finished pickup for ${req.name || "rider"}.`, "success");
  renderAll();
}

function driverRequestItem(req) {
  const created = new Date(req.createdAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  let distLabel = "—";
  if (state.geo.last) {
    const km = haversineKm(state.geo.last.lat, state.geo.last.lng, req.lat, req.lng);
    distLabel = fmtDistanceMi(kmToMi(km));
  }

  const el = document.createElement("div");
  el.className = "item";
  const isPending = req.status === "pending";
  const isAssigned = req.status === "assigned";
  const riderPhoneDigits = digitsOnly(req.riderPhone || "");
  const call =
    riderPhoneDigits && (isPending || isAssigned)
      ? callButtonHtml(riderPhoneDigits, `Call ${req.name || "rider"}`)
      : "";
  el.innerHTML = `
    <div class="item__top">
      <div>
        <div class="item__title">${escapeHtml(req.name)}</div>
        <div class="item__meta">${escapeHtml(created)} • ${escapeHtml(distLabel)} away</div>
      </div>
      <div class="item__side">
        ${call}
        <div class="item__meta">${escapeHtml(req.status)}</div>
      </div>
    </div>
    <div class="item__actions">
      <button class="btn btn--primary" data-action="accept" ${!isPending ? "disabled" : ""}>${
        isAssigned ? "Accepted" : "Accept"
      }</button>
      ${isPending ? `<button class="btn btn--danger" data-action="decline">Decline</button>` : ""}
      ${
        isAssigned
          ? `<button class="btn" data-action="maps">Open Google Maps</button>
             <button class="btn btn--ghost" data-action="done">Done</button>`
          : ""
      }
    </div>
  `;

  const btnAccept = el.querySelector('[data-action="accept"]');
  const btnDecline = el.querySelector('[data-action="decline"]');
  const btnMaps = el.querySelector('[data-action="maps"]');
  const btnDone = el.querySelector('[data-action="done"]');

  btnAccept.addEventListener("click", async () => {
    btnAccept.disabled = true;
    try {
      let contact = getSavedDriverContact();
      if (!contact) {
        const entered = await promptDriverContact("Driver details", "Save");
        if (!entered) return;
        contact = { name: entered.name, phone: entered.phone };
      }
      await acceptRequest(req, contact);
    } catch (e) {
      const msg =
        e.message === "INVALID_DRIVER_PHONE"
          ? "Please enter a valid driver phone number."
          : e.message;
      alert(`Could not accept: ${msg}`);
    } finally {
      btnAccept.disabled = false;
    }
  });

  if (btnDecline) {
    btnDecline.addEventListener("click", async () => {
      if (!confirm("Decline this pickup request?")) return;
      btnDecline.disabled = true;
      try {
        await declineRequest(req);
      } catch (e) {
        alert(`Could not decline: ${e.message}`);
      } finally {
        btnDecline.disabled = false;
      }
    });
  }

  if (btnMaps) btnMaps.addEventListener("click", () => openMapsForRequest(req));

  if (btnDone) btnDone.addEventListener("click", async () => {
    btnDone.disabled = true;
    try {
      await completeRequest(req);
    } catch (e) {
      alert(`Could not complete: ${e.message}`);
    } finally {
      btnDone.disabled = false;
    }
  });

  return el;
}

function driverListItem(driver) {
  const el = document.createElement("div");
  el.className = "item";
  const updatedAt = driver.last?.updatedAt ?? 0;
  const age = updatedAt ? fmtAgeMs(Date.now() - updatedAt) : "—";
  let distLabel = "—";
  let etaLabel = "—";

  if (state.geo.last && driver.last) {
    const km = haversineKm(state.geo.last.lat, state.geo.last.lng, driver.last.lat, driver.last.lng);
    const mi = kmToMi(km);
    distLabel = fmtDistanceMi(mi);
    const speedKmhRaw = Number(state.config?.assumedSpeedKmh);
    const speedKmh = Number.isFinite(speedKmhRaw) ? speedKmhRaw : 40;
    etaLabel = fmtEtaMinutes(etaMinutesFromKm(km, speedKmh));
  }

  const hasActive = Boolean(getActiveRiderRequest());
  const disabled = state.rider.locked || hasActive || !state.geo.last || !driver.last;

  el.innerHTML = `
    <div class="item__top">
      <div>
        <div class="item__title">${escapeHtml(driver.name)}</div>
        <div class="item__meta">${escapeHtml(etaLabel)} • ${escapeHtml(distLabel)} away • updated ${escapeHtml(age)}</div>
      </div>
      <div class="badge badge--online"><span class="dot dot--online"></span>Online</div>
    </div>
    <div class="item__actions">
      <button class="btn btn--primary" data-action="request" ${disabled ? "disabled" : ""}>Request pickup</button>
    </div>
  `;

  const btn = el.querySelector('[data-action="request"]');
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const contact = await promptRiderContact(driver.name);
      if (!contact) return;
      await requestPickup(driver.id, { name: contact.name, phone: contact.phone });
    } catch (e) {
      const maxMinutesRaw = Number(state.config?.maxPickupMinutes);
      const maxMinutes = Number.isFinite(maxMinutesRaw) ? maxMinutesRaw : 10;
      const msg =
        e.message === "RIDER_LOCKED"
          ? "This request was already accepted. Reload the page to start a new request."
          : e.message === "LOCATION_REQUIRED"
          ? "Enable location to request a ride."
          : e.message === "DRIVER_AT_CAPACITY"
            ? `This driver already has ${(e.data && e.data.capacity) || 3} requests. Please pick another driver.`
            : e.message === "TOO_FAR"
              ? `This driver is more than ${maxMinutes} minutes away.`
          : e.message === "INVALID_RIDER_PHONE"
            ? "Please enter a valid phone number."
            : e.message;
      alert(msg);
    } finally {
      btn.disabled = false;
    }
  });

  return el;
}

function renderDriverView() {
  if (state.role !== "driver") return;

  els.driverStatePill.textContent = state.driver.online ? "Online" : "Offline";
  els.driverStatePill.classList.toggle("pill--online", state.driver.online);
  els.btnDriverToggle.textContent = state.driver.online ? "Go Offline" : "Go Online";
  els.btnDriverToggle.classList.remove("btn--primary");
  els.btnDriverToggle.classList.toggle("btn--success", !state.driver.online);
  els.btnDriverToggle.classList.toggle("btn--danger", state.driver.online);

  const reqs = Array.from(state.live.requests.values()).filter(
    (r) => r.status === "pending" || r.status === "assigned",
  );
  reqs.sort((a, b) => a.createdAt - b.createdAt);
  els.driverRequests.innerHTML = "";
  for (const req of reqs) els.driverRequests.appendChild(driverRequestItem(req));
  els.driverRequestsEmpty.hidden = reqs.length > 0;
}

function renderRiderView() {
  if (state.role !== "rider") return;

  if (els.driversSectionTitle) els.driversSectionTitle.hidden = false;
  const active = getActiveRiderRequest();
  if (active) {
    if (els.driversSectionTitle) els.driversSectionTitle.hidden = true;
    els.riderActive.hidden = false;
    els.btnCancelRequest.hidden = false;
    if (active.status === "pending") {
      const ttlMinRaw = Number(state.config?.requestTtlMinutes);
      const ttlMin = Number.isFinite(ttlMinRaw) ? ttlMinRaw : 5;
      const ageMin = Math.max(0, (Date.now() - Number(active.createdAt || 0)) / 60_000);
      const remainingMin = Math.max(0, Math.ceil(ttlMin - ageMin));
      els.riderActive.innerHTML = `
        <div class="notice__title">Request sent</div>
        <div class="notice__text">Waiting for ${escapeHtml(active.targetDriverName || "driver")} to accept…</div>
        <div class="notice__text">Expires in ~${escapeHtml(remainingMin)} min</div>
      `;
    } else {
      els.riderActive.innerHTML = `
        <div class="notice__title">Request update</div>
        <div class="notice__text">Status: ${escapeHtml(active.status)}</div>
      `;
    }

    // Only one request at a time: hide the drivers list while waiting.
    els.driversList.innerHTML = "";
    els.driversEmpty.textContent = "";
    els.driversEmpty.hidden = true;
    return;
  } else {
    els.riderActive.hidden = true;
    els.btnCancelRequest.hidden = true;
  }

  if (state.rider.locked) {
    if (els.driversSectionTitle) els.driversSectionTitle.hidden = true;
    els.riderActive.hidden = false;
    const phoneDigits = digitsOnly(state.rider.assigned?.phone || "");
    const driverName = state.rider.assigned?.name || "driver";
    els.riderActive.innerHTML = `
      <div class="notice__title">Driver accepted</div>
      <div class="notice__text">Name: ${escapeHtml(driverName)}</div>
      <div class="notice__text metaRow"><span>Call driver</span>${
        phoneDigits ? callButtonHtml(phoneDigits, `Call ${driverName}`) : ""
      }</div>
      <div class="notice__text">Reload the page to start a new request.</div>
    `;
    els.driversList.innerHTML = "";
    els.driversEmpty.textContent = "";
    els.driversEmpty.hidden = true;
    return;
  }

  if (!state.geo.last) {
    els.driversList.innerHTML = "";
    els.driversEmpty.textContent = "Enable location to see drivers within 10 minutes.";
    els.driversEmpty.hidden = false;
    return;
  }

  const maxMinutesRaw = Number(state.config?.maxPickupMinutes);
  const maxMinutes = Number.isFinite(maxMinutesRaw) ? maxMinutesRaw : 10;
  const speedKmhRaw = Number(state.config?.assumedSpeedKmh);
  const speedKmh = Number.isFinite(speedKmhRaw) ? speedKmhRaw : 40;

  const drivers = Array.from(state.live.drivers.values())
    .filter((d) => d.last)
    .map((d) => {
      const km = haversineKm(state.geo.last.lat, state.geo.last.lng, d.last.lat, d.last.lng);
      const eta = etaMinutesFromKm(km, speedKmh);
      return { driver: d, eta };
    })
    .filter(({ eta }) => Number.isFinite(eta) && eta <= maxMinutes)
    .sort((a, b) => a.eta - b.eta)
    .map(({ driver }) => driver);

  els.driversList.innerHTML = "";
  for (const d of drivers) els.driversList.appendChild(driverListItem(d));
  els.driversEmpty.textContent =
    drivers.length > 0 ? "" : `No drivers within ${maxMinutes} minutes right now.`;
  els.driversEmpty.hidden = drivers.length > 0;
}

function renderAll() {
  setActiveTab(state.ui.activeTab);
  if (state.ui.activeTab === "activity") return;

  setLocationText();
  els.locationCard.hidden = Boolean(state.geo.last);
  els.driverCard.hidden = state.role !== "driver";
  els.riderCard.hidden = state.role !== "rider";
  els.roleCard.hidden = state.role === "driver" || state.role === "rider";
  renderDriverView();
  renderRiderView();
}

function resetAll() {
  disconnectStream();
  stopGeoWatch();
  stopDriverHeartbeat();
  localStorage.clear();
  location.href = location.pathname;
}

function initEvents() {
  els.btnEnableLocation.addEventListener("click", primeLocation);
  document.addEventListener(
    "pointerdown",
    () => {
      unlockAudio().catch(() => {});
      if (state.geo.last || state.geo.inFlight) return;
      primeLocation().catch(() => {});
    },
    { once: true },
  );

  els.tabHome.addEventListener("click", () => {
    setActiveTab("home");
    renderAll();
  });
  els.tabActivity.addEventListener("click", () => {
    setActiveTab("activity");
    renderAll();
  });
  if (els.btnTheme) {
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
      applyTheme(next, { persist: false });
      state.ui.theme = next;
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
      applyTheme(next, { persist: true });
      state.ui.theme = next;
    });
  }
  els.btnClearActivity.addEventListener("click", () => {
    state.activity = [];
    saveActivity();
    renderActivity();
  });

  els.sheetOverlay.addEventListener("click", closeSheet);
  els.sheetClose.addEventListener("click", closeSheet);
  els.sheetCancel.addEventListener("click", closeSheet);
  els.sheetConfirm.addEventListener("click", async () => {
    if (typeof state.sheet.onConfirm !== "function") {
      closeSheet();
      return;
    }
    els.sheetConfirm.disabled = true;
    try {
      await state.sheet.onConfirm();
    } finally {
      if (state.sheet.open) els.sheetConfirm.disabled = false;
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!state.sheet.open) return;
    if (e.key === "Escape") closeSheet();
    if (e.key === "Enter") {
      const tag = String(e.target?.tagName ?? "").toLowerCase();
      if (tag === "textarea") return;
      els.sheetConfirm.click();
    }
  });

  els.btnRoleDriver.addEventListener("click", () => showRole("driver"));
  els.btnRoleRider.addEventListener("click", () => showRole("rider"));
  els.btnSwitchToRider.addEventListener("click", clearRole);
  els.btnSwitchToDriver.addEventListener("click", clearRole);
  els.btnReset.addEventListener("click", () => location.reload());

  els.btnDriverToggle.addEventListener("click", async () => {
    els.btnDriverToggle.disabled = true;
    try {
      await setDriverOnline(!state.driver.online);
    } catch (e) {
      if (e.message === "CANCELLED") return;
      const msg = e.message === "LOCATION_REQUIRED" ? "Enable location to go online." : e.message;
      alert(msg);
    } finally {
      els.btnDriverToggle.disabled = false;
    }
  });

  els.btnCancelRequest.addEventListener("click", async () => {
    els.btnCancelRequest.disabled = true;
    try {
      await cancelPickup();
    } catch (e) {
      alert(`Could not cancel: ${e.message}`);
    } finally {
      els.btnCancelRequest.disabled = false;
    }
  });
}

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  // Follow system theme unless the user has explicitly picked one.
  try {
    const media = window.matchMedia?.("(prefers-color-scheme: light)") ?? null;
    state.ui.themeMedia = media;
    const hasSaved = localStorage.getItem(STORAGE_KEYS.theme) != null;
    if (media && !hasSaved) {
      const onChange = () => {
        const stillNoSaved = localStorage.getItem(STORAGE_KEYS.theme) == null;
        if (!stillNoSaved) return;
        const next = media.matches ? "light" : "dark";
        applyTheme(next, { persist: false });
        state.ui.theme = next;
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

  initEvents();
  await api("/api/config")
    .then((cfg) => {
      state.config = cfg;
      els.daysHint.textContent = `Most active: ${cfg.daysOpen.join(" • ")}.`;
    })
    .catch(() => {});

  // Ask for location as soon as they visit.
  await primeLocation();

  if (state.role === "driver" || state.role === "rider") {
    els.roleCard.hidden = true;
    startGeoWatch();
    connectStream();
    if (state.role === "driver" && state.driver.online) startDriverHeartbeat();
  }

  // Force a quick refresh of "available drivers" and timestamps.
  state.ui.refreshTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (state.ui.activeTab !== "home") return;
    if (state.role !== "driver" && state.role !== "rider") return;
    renderAll();
  }, 10_000);

  renderAll();
}

init();
