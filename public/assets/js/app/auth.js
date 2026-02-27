import { STORAGE_KEYS } from "./constants.js";
import { api } from "./api.js";
import { digitsOnly, isValidPhoneDigits } from "./utils.js";

function normalizeRole(role) {
  const value = String(role || "")
    .trim()
    .toLowerCase();
  if (value === "driver" || value === "rider") return value;
  return "";
}

export function loadAuth() {
  const legacyToken = (localStorage.getItem("ewc.driver.authToken") ?? "").trim();
  const legacyPhone = digitsOnly(localStorage.getItem("ewc.driver.authPhone") ?? "");
  const legacyName = (localStorage.getItem("ewc.driver.authName") ?? "").trim();
  if (!localStorage.getItem(STORAGE_KEYS.authToken) && legacyToken) {
    localStorage.setItem(STORAGE_KEYS.authToken, legacyToken);
  }
  if (!localStorage.getItem(STORAGE_KEYS.authPhone) && isValidPhoneDigits(legacyPhone)) {
    localStorage.setItem(STORAGE_KEYS.authPhone, legacyPhone);
  }
  if (!localStorage.getItem(STORAGE_KEYS.authName) && legacyName) {
    localStorage.setItem(STORAGE_KEYS.authName, legacyName);
  }

  const token = (localStorage.getItem(STORAGE_KEYS.authToken) ?? "").trim();
  const role = normalizeRole(localStorage.getItem(STORAGE_KEYS.authRole) ?? "");
  const email = (localStorage.getItem(STORAGE_KEYS.authEmail) ?? "").trim().toLowerCase();
  const phone = digitsOnly(localStorage.getItem(STORAGE_KEYS.authPhone) ?? "");
  const name = (localStorage.getItem(STORAGE_KEYS.authName) ?? "").trim();

  return {
    token: token || "",
    role: role || "",
    email: email || "",
    phone: isValidPhoneDigits(phone) ? phone : "",
    name: name || "",
  };
}

export function saveAuth({ token, role, email, phone, name }) {
  if (token) localStorage.setItem(STORAGE_KEYS.authToken, token);
  if (role) localStorage.setItem(STORAGE_KEYS.authRole, normalizeRole(role));
  if (email) localStorage.setItem(STORAGE_KEYS.authEmail, String(email || "").trim().toLowerCase());
  if (phone) localStorage.setItem(STORAGE_KEYS.authPhone, digitsOnly(phone));
  if (name) localStorage.setItem(STORAGE_KEYS.authName, String(name || "").trim());
}

export function clearAuth() {
  localStorage.removeItem(STORAGE_KEYS.authToken);
  localStorage.removeItem(STORAGE_KEYS.authRole);
  localStorage.removeItem(STORAGE_KEYS.authEmail);
  localStorage.removeItem(STORAGE_KEYS.authPhone);
  localStorage.removeItem(STORAGE_KEYS.authName);
}

export async function registerUser({ name, phone, email, password, role }) {
  return api("/api/auth/register", {
    method: "POST",
    body: { name, phone, email, password, role },
  });
}

export async function loginUser({ identifier, password, role }) {
  const normalized = String(identifier || "").trim();
  return api("/api/auth/login", {
    method: "POST",
    body: {
      identifier: normalized,
      email: normalized,
      phone: normalized,
      password,
      role,
    },
  });
}

export async function getAuthMe(token) {
  return api("/api/auth/me", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
}
