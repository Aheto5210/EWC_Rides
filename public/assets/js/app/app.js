import { STORAGE_KEYS } from "./constants.js";
import { api } from "./api.js";
import { addActivity, clearActivity, renderActivity } from "./activity.js";
import {
  clearDriverAuth,
  getDriverMe,
  loginDriver,
  resolveDriverLogin,
  registerDriver,
  saveDriverAuth,
} from "./auth.js";
import { createAudio } from "./audio.js";
import { callButtonHtml } from "./call.js";
import { els } from "./dom.js";
import { createGeo } from "./geo.js";
import { createNotifications } from "./notifications.js";
import { createSheet } from "./sheet.js";
import { createState } from "./state.js";
import { initTheme } from "./theme.js";
import {
  digitsOnly,
  driverDisplayName,
  escapeHtml,
  etaMinutesFromKm,
  fmtAgeMs,
  fmtDistanceMi,
  fmtEtaMinutes,
  haversineKm,
  isValidPhoneDigits,
  kmToMi,
  mapsDirectionsUrl,
} from "./utils.js";

const state = createState();
initTheme({ state, els });

const sheet = createSheet(state, els);
const {
  closeSheet,
  promptRiderContact,
  promptDriverContact,
  promptDriverRegister,
  promptDriverCode,
  promptDriverPick,
  showDriverCode,
} = sheet;

const audio = createAudio({ state });
const {
  primeAlertAudio,
  playNotificationSound,
  playAcceptedSound,
  updateRequestAlarm,
  stopRequestAlarm,
} = audio;

const notifications = createNotifications({ state });
const { ensureNotificationPermission, showDriverNotification } = notifications;

const geo = createGeo({ state, els, onChange: handleGeoChange });
const { setLocationText, primeLocation, startGeoWatch, stopGeoWatch } = geo;

function handleGeoChange() {
  if (state.role === "driver" && state.driver.online) {
    postDriverLocation().catch(() => {});
  }
  renderAll();
}

function setActiveTab(tab) {
  state.ui.activeTab = tab === "activity" ? "activity" : "home";
  els.tabHome.setAttribute("aria-selected", state.ui.activeTab === "home" ? "true" : "false");
  els.tabActivity.setAttribute(
    "aria-selected",
    state.ui.activeTab === "activity" ? "true" : "false",
  );
  els.homeView.hidden = state.ui.activeTab !== "home";
  els.activityView.hidden = state.ui.activeTab !== "activity";
  if (state.ui.activeTab === "activity") renderActivity(state, els);
}

function disconnectStream() {
  if (!state.eventSource) return;
  state.eventSource.close();
  state.eventSource = null;
  stopRequestAlarm();
}

function clearEwcLocalStorage() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith("ewc.")) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // ignore
  }
}

async function hardReload() {
  els.btnReset.disabled = true;
  els.btnReset.classList.add("link--loading");

  try {
    if (state.role === "driver" && state.driver.online) {
      await setDriverOnline(false).catch(() => {});
    }
  } catch {
    // ignore
  }

  try {
    disconnectStream();
  } catch {
    // ignore
  }

  try {
    stopGeoWatch();
  } catch {
    // ignore
  }

  try {
    closeSheet();
  } catch {
    // ignore
  }

  try {
    clearActivity(state, els);
  } catch {
    // ignore
  }

  // Clear app storage (localStorage), service worker + Cache Storage.
  clearEwcLocalStorage();

  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(regs.map((r) => r.unregister()));
    }
  } catch {
    // ignore
  }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // ignore
  }

  // Bust any remaining in-memory state by doing a fresh navigation.
  const u = new URL(location.href);
  u.searchParams.set("r", String(Date.now()));
  location.replace(u.toString());
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
  if (state.role === "driver" && state.driver.auth.token) {
    params.set("token", state.driver.auth.token);
  }

  state.eventSource = new EventSource(`/api/stream?${params.toString()}`);

  state.eventSource.addEventListener("snapshot", (evt) => {
    const data = JSON.parse(evt.data);
    state.config = data.config || null;

    state.live.drivers.clear();
    for (const d of data.drivers || []) state.live.drivers.set(d.id, d);

    state.live.requests.clear();
    for (const r of data.requests || []) state.live.requests.set(r.id, r);

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
      addActivity(state, els, "New pickup request", `${r.name || "rider"}`, "warning", {
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
        addActivity(state, els, "Driver accepted", `${r.assignedDriverName || "driver"}`, "success", {
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
        addActivity(
          state,
          els,
          "Request expired",
          "No driver response in time. Pick a driver again.",
          "warning",
        );
      } else if (reason === "declined") {
        addActivity(state, els, "Request declined", "Pick another driver.", "danger");
      }
    }

    if (state.role === "driver" && prev && prev.status === "pending") {
      if (reason === "cancelled") {
        addActivity(state, els, "Rider cancelled", `${prev.name || "rider"} cancelled the request.`, "info");
      } else if (reason === "expired") {
        addActivity(state, els, "Request expired", `${prev.name || "rider"} request timed out.`, "warning");
      }
    }

    updateRequestAlarm();
    renderAll();
  });
}

function driverAuthHeaders() {
  const token = (state.driver.auth.token ?? "").trim();
  if (!token) return {};
  return { authorization: `Bearer ${token}` };
}

function saveDriverAuthState({ token, driver }) {
  if (token) state.driver.auth.token = token;
  if (driver?.phone) state.driver.auth.phone = digitsOnly(driver.phone);
  if (driver?.name) state.driver.auth.name = String(driver.name || "").trim();
  saveDriverAuth({
    token: state.driver.auth.token,
    phone: state.driver.auth.phone,
    name: state.driver.auth.name,
  });
}

function resetDriverAuthState() {
  state.driver.auth.token = "";
  state.driver.auth.phone = "";
  state.driver.auth.name = "";
  clearDriverAuth();
}

async function ensureDriverAuth({ interactive } = { interactive: false }) {
  const token = (state.driver.auth.token ?? "").trim();
  if (token) {
    try {
      const me = await getDriverMe(token);
      saveDriverAuthState({ token, driver: me.driver });
      return true;
    } catch {
      resetDriverAuthState();
    }
  }

  if (!interactive) return false;

  let phone = digitsOnly(
    state.driver.auth.phone || localStorage.getItem(STORAGE_KEYS.driverAuthPhone) || "",
  );

  const entered = await promptDriverCode();
  if (!entered) return false;

  try {
    const result = await loginDriver({
      phone: isValidPhoneDigits(phone) ? phone : "",
      code: entered.code,
    });
    saveDriverAuthState({ token: result.token, driver: result.driver });
    return true;
  } catch (e) {
    if (e.message === "CODE_AMBIGUOUS" && Array.isArray(e.data?.choices)) {
      const idx = await promptDriverPick(e.data.choices);
      if (idx === null || typeof idx === "undefined") return false;
      try {
        const resolved = await resolveDriverLogin({
          challengeId: e.data.challengeId,
          choiceIndex: idx,
        });
        saveDriverAuthState({ token: resolved.token, driver: resolved.driver });
        return true;
      } catch (e2) {
        alert(e2.message);
        return false;
      }
    }

    const msg =
      e.message === "DRIVER_NOT_REGISTERED"
        ? "Not registered yet. Tap “Register as a driver” first."
        : e.message === "INVALID_CODE"
          ? "Wrong code. Try again."
          : e.message;
    alert(msg);
    return false;
  }
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
    headers: driverAuthHeaders(),
    body: {
      room: state.room,
      code: state.roomCode || undefined,
      driverId: state.deviceId,
      lat: state.geo.last.lat,
      lng: state.geo.last.lng,
      accuracyM: state.geo.last.accuracyM,
      heading: state.geo.last.heading,
      speedMps: state.geo.last.speedMps,
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

async function setDriverOnline(online) {
  if (online) {
    if (!(await ensureDriverAuth({ interactive: true }))) throw new Error("CANCELLED");

    await primeAlertAudio().catch(() => {});
    ensureNotificationPermission().catch(() => {});

    if (!state.geo.last) {
      await primeLocation();
    }
    if (!state.geo.last) throw new Error("LOCATION_REQUIRED");

    await api("/api/driver/start", {
      method: "POST",
      headers: driverAuthHeaders(),
      body: {
        room: state.room,
        code: state.roomCode || undefined,
        driverId: state.deviceId,
      },
    });

    state.driver.online = true;
    startGeoWatch();
    await postDriverLocation().catch(() => {});
    startDriverHeartbeat();
    addActivity(state, els, "Driver online", "You’re now visible to riders.", "success");
  } else {
    if (!state.driver.auth.token) {
      await ensureDriverAuth({ interactive: true }).catch(() => {});
    }
    await api("/api/driver/stop", {
      method: "POST",
      headers: driverAuthHeaders(),
      body: {
        room: state.room,
        code: state.roomCode || undefined,
        driverId: state.deviceId,
      },
    });
    state.driver.online = false;
    stopDriverHeartbeat();
    addActivity(state, els, "Driver offline", "You stopped sharing your location.", "danger");
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
  addActivity(state, els, "Ride requested", `To ${req.targetDriverName || "driver"}.`, "info");
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
  addActivity(state, els, "Ride cancelled", "You cancelled your request.", "danger");
  renderAll();
}

function openMapsForRequest(req) {
  const origin = state.geo.last
    ? { originLat: state.geo.last.lat, originLng: state.geo.last.lng }
    : {};
  const url = mapsDirectionsUrl({ ...origin, destLat: req.lat, destLng: req.lng });
  window.open(url, "_blank", "noopener,noreferrer");
}

async function acceptRequest(req) {
  if (!(await ensureDriverAuth({ interactive: true }))) throw new Error("CANCELLED");

  const result = await api("/api/ride/accept", {
    method: "POST",
    headers: driverAuthHeaders(),
    body: {
      room: state.room,
      code: state.roomCode || undefined,
      driverId: state.deviceId,
      requestId: req.id,
    },
  });
  const updated = result.request;
  state.live.requests.set(updated.id, updated);
  playAcceptedSound();
  addActivity(state, els, "Pickup accepted", `Rider: ${updated.name || "rider"}`, "success", {
    phoneDigits: updated.riderPhone || "",
    callLabel: `Call ${updated.name || "rider"}`,
  });
  updateRequestAlarm();
  renderAll();
}

async function declineRequest(req) {
  if (!(await ensureDriverAuth({ interactive: true }))) throw new Error("CANCELLED");
  await api("/api/ride/decline", {
    method: "POST",
    headers: driverAuthHeaders(),
    body: {
      room: state.room,
      code: state.roomCode || undefined,
      driverId: state.deviceId,
      requestId: req.id,
    },
  });
  state.live.requests.delete(req.id);
  addActivity(state, els, "Request declined", `Rider: ${req.name || "rider"}`, "danger", {
    phoneDigits: req.riderPhone || "",
    callLabel: `Call ${req.name || "rider"}`,
  });
  updateRequestAlarm();
  renderAll();
}

async function completeRequest(req) {
  if (!(await ensureDriverAuth({ interactive: true }))) throw new Error("CANCELLED");
  await api("/api/ride/complete", {
    method: "POST",
    headers: driverAuthHeaders(),
    body: {
      room: state.room,
      code: state.roomCode || undefined,
      driverId: state.deviceId,
      requestId: req.id,
    },
  });
  state.live.requests.delete(req.id);
  addActivity(state, els, "Pickup completed", `Finished pickup for ${req.name || "rider"}.`, "success");
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
      await acceptRequest(req);
    } catch (e) {
      if (e.message === "CANCELLED") return;
      alert(`Could not accept: ${e.message}`);
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

function initEvents() {
  els.btnEnableLocation.addEventListener("click", () => primeLocation().catch(() => {}));
  document.addEventListener(
    "pointerdown",
    () => {
      primeAlertAudio().catch(() => {});
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

  els.btnClearActivity.addEventListener("click", () => {
    clearActivity(state, els);
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

  els.btnRoleDriver.addEventListener("click", async () => {
    els.btnRoleDriver.disabled = true;
    try {
      const ok = await ensureDriverAuth({ interactive: true });
      if (!ok) return;
      showRole("driver");
    } finally {
      els.btnRoleDriver.disabled = false;
    }
  });
  els.btnRoleRider.addEventListener("click", () => showRole("rider"));
  els.btnRegisterDriver.addEventListener("click", async () => {
    els.btnRegisterDriver.disabled = true;
    try {
      const entered = await promptDriverRegister();
      if (!entered) return;

      const reg = await registerDriver({ name: entered.name, phone: entered.phone });
      saveDriverAuthState({ token: "", driver: { name: entered.name, phone: entered.phone } });

      await showDriverCode(reg.code || "");

      try {
        const login = await loginDriver({ phone: entered.phone, code: reg.code });
        saveDriverAuthState({ token: login.token, driver: login.driver });
        addActivity(state, els, "Driver registered", "You can now go online as a driver.", "success");
      } catch {
        // ignore auto-login errors; driver can login manually.
      }
      renderAll();
    } catch (e) {
      alert(`Could not register: ${e.message}`);
    } finally {
      els.btnRegisterDriver.disabled = false;
    }
  });
  els.btnSwitchToRider.addEventListener("click", clearRole);
  els.btnSwitchToDriver.addEventListener("click", clearRole);

  els.btnReset.addEventListener("click", () => {
    hardReload().catch(() => {
      // Worst case fallback.
      location.reload();
    });
  });

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

  initEvents();

  await api("/api/config")
    .then((cfg) => {
      state.config = cfg;
      if (els.daysHint) els.daysHint.textContent = `Most active: ${cfg.daysOpen.join(" • ")}.`;
    })
    .catch(() => {});

  await primeLocation();

  if (state.role === "driver") {
    const ok = await ensureDriverAuth({ interactive: false });
    if (!ok) {
      state.role = "";
      localStorage.removeItem(STORAGE_KEYS.role);
    }
  }

  if (state.role === "driver" || state.role === "rider") {
    els.roleCard.hidden = true;
    startGeoWatch();
    connectStream();
  }

  state.ui.refreshTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (state.ui.activeTab !== "home") return;
    if (state.role !== "driver" && state.role !== "rider") return;
    renderAll();
  }, 10_000);

  renderAll();
}

init();
