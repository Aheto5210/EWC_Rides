import { STORAGE_KEYS } from "./constants.js";
import { loadActivity } from "./activity.js";
import { loadDriverAuth } from "./auth.js";
import { getOrCreateDeviceId } from "./storage.js";
import { sanitizeRoom } from "./utils.js";

export const urlParams = new URLSearchParams(location.search);

export function createState() {
  const savedAuth = loadDriverAuth();
  const state = {
    deviceId: getOrCreateDeviceId(),
    room: sanitizeRoom(urlParams.get("room") ?? localStorage.getItem(STORAGE_KEYS.room)),
    roomCode: (urlParams.get("code") ?? localStorage.getItem(STORAGE_KEYS.roomCode) ?? "").trim(),
    role: localStorage.getItem(STORAGE_KEYS.role) || "",
    config: null,
    eventSource: null,
    ui: {
      activeTab: "home",
      theme: "dark",
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
      sampleAllowed: false,
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
      auth: {
        token: savedAuth.token,
        phone: savedAuth.phone,
        name: savedAuth.name,
      },
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

  return state;
}
