import { STORAGE_KEYS } from "./constants.js";
import { api } from "./api.js";
import { addActivity, clearActivity, renderActivity } from "./activity.js";
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
const { closeSheet, promptRiderContact, promptDriverContact } = sheet;

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

    await primeAlertAudio().catch(() => {});
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
    addActivity(state, els, "Driver online", "You’re now visible to riders.", "success");
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
  playAcceptedSound();
  addActivity(state, els, "Pickup accepted", `Rider: ${updated.name || "rider"}`, "success", {
    phoneDigits: updated.riderPhone || "",
    callLabel: `Call ${updated.name || "rider"}`,
  });
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
  addActivity(state, els, "Request declined", `Rider: ${req.name || "rider"}`, "danger", {
    phoneDigits: req.riderPhone || "",
    callLabel: `Call ${req.name || "rider"}`,
  });
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

  els.btnRoleDriver.addEventListener("click", () => showRole("driver"));
  els.btnRoleRider.addEventListener("click", () => showRole("rider"));
  els.btnSwitchToRider.addEventListener("click", clearRole);
  els.btnSwitchToDriver.addEventListener("click", clearRole);

  els.btnReset.addEventListener("click", () => {
    clearActivity(state, els);
    try {
      closeSheet();
    } catch {
      // ignore
    }
    els.btnReset.disabled = true;
    els.btnReset.classList.add("link--loading");
    setTimeout(() => location.reload(), 160);
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

