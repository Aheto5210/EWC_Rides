import { STORAGE_KEYS } from "./constants.js";

export function getOrCreateDeviceId() {
  const existing = localStorage.getItem(STORAGE_KEYS.deviceId);
  if (existing) return existing;
  const id =
    typeof crypto?.randomUUID === "function"
      ? crypto.randomUUID()
      : `dev_${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(STORAGE_KEYS.deviceId, id);
  return id;
}

