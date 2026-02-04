import { STORAGE_KEYS } from "./constants.js";
import { api } from "./api.js";
import { digitsOnly, isValidPhoneDigits } from "./utils.js";

export function loadDriverAuth() {
  // Migration from older keys (driverName/driverPhone) -> auth keys.
  const legacyPhone = digitsOnly(localStorage.getItem(STORAGE_KEYS.driverPhone) ?? "");
  const legacyName = (localStorage.getItem(STORAGE_KEYS.driverName) ?? "").trim();
  if (!localStorage.getItem(STORAGE_KEYS.driverAuthPhone) && isValidPhoneDigits(legacyPhone)) {
    localStorage.setItem(STORAGE_KEYS.driverAuthPhone, legacyPhone);
  }
  if (!localStorage.getItem(STORAGE_KEYS.driverAuthName) && legacyName) {
    localStorage.setItem(STORAGE_KEYS.driverAuthName, legacyName);
  }

  const token = (localStorage.getItem(STORAGE_KEYS.driverAuthToken) ?? "").trim();
  const phone = digitsOnly(localStorage.getItem(STORAGE_KEYS.driverAuthPhone) ?? "");
  const name = (localStorage.getItem(STORAGE_KEYS.driverAuthName) ?? "").trim();
  return {
    token: token || "",
    phone: isValidPhoneDigits(phone) ? phone : "",
    name: name || "",
  };
}

export function saveDriverAuth({ token, phone, name }) {
  if (token) localStorage.setItem(STORAGE_KEYS.driverAuthToken, token);
  if (phone) localStorage.setItem(STORAGE_KEYS.driverAuthPhone, digitsOnly(phone));
  if (name) localStorage.setItem(STORAGE_KEYS.driverAuthName, String(name || "").trim());
}

export function clearDriverAuth() {
  localStorage.removeItem(STORAGE_KEYS.driverAuthToken);
  localStorage.removeItem(STORAGE_KEYS.driverAuthPhone);
  localStorage.removeItem(STORAGE_KEYS.driverAuthName);
}

export async function registerDriver({ name, phone }) {
  return api("/api/auth/driver/register", {
    method: "POST",
    body: { name, phone },
  });
}

export async function loginDriver({ phone, code }) {
  const payload = { code };
  if (phone) payload.phone = phone;
  return api("/api/auth/driver/login", {
    method: "POST",
    body: payload,
  });
}

export async function resolveDriverLogin({ challengeId, choiceIndex }) {
  return api("/api/auth/driver/login/resolve", {
    method: "POST",
    body: { challengeId, choiceIndex },
  });
}

export async function getDriverMe(token) {
  return api("/api/auth/driver/me", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
}
