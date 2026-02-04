export function sanitizeRoom(room) {
  const trimmed = (room ?? "").toString().trim().toLowerCase();
  if (!trimmed) return "ewc";
  return trimmed.replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "ewc";
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

export function isValidPhoneDigits(digits) {
  return typeof digits === "string" && digits.length >= 7;
}

export function sanitizeTone(tone) {
  const t = String(tone ?? "").toLowerCase();
  if (t === "success" || t === "warning" || t === "danger" || t === "info") return t;
  return "info";
}

export function formatPhoneDigits(digits) {
  const d = digitsOnly(digits);
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (d.length === 11 && d.startsWith("1")) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  }
  return d;
}

export function telHref(digits) {
  const d = digitsOnly(digits);
  return d ? `tel:${d}` : "#";
}

export function shortId(id) {
  const clean = String(id ?? "").replaceAll("-", "");
  return clean.slice(0, 4).toUpperCase() || "EWC";
}

export function driverDisplayName(deviceId) {
  return `Car ${shortId(deviceId)}`;
}

export function riderDisplayName(deviceId) {
  return `Member ${shortId(deviceId)}`;
}

export function haversineKm(aLat, aLng, bLat, bLng) {
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

export function kmToMi(km) {
  return km * 0.621371;
}

export function fmtDistanceMi(mi) {
  if (!Number.isFinite(mi)) return "—";
  if (mi < 0.1) return "< 0.1 mi";
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

export function fmtAgeMs(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m}m ago`;
}

export function etaMinutesFromKm(km, speedKmh) {
  const s = Number(speedKmh);
  if (!Number.isFinite(km) || !Number.isFinite(s) || s <= 0) return Infinity;
  return (km / s) * 60;
}

export function fmtEtaMinutes(min) {
  if (!Number.isFinite(min)) return "—";
  if (min < 1) return "< 1 min";
  return `~${Math.round(min)} min`;
}

export function mapsDirectionsUrl({ originLat, originLng, destLat, destLng }) {
  const base = "https://www.google.com/maps/dir/?api=1";
  const dest = `destination=${encodeURIComponent(`${destLat},${destLng}`)}`;
  const origin =
    Number.isFinite(originLat) && Number.isFinite(originLng)
      ? `&origin=${encodeURIComponent(`${originLat},${originLng}`)}`
      : "";
  return `${base}&${dest}${origin}&travelmode=driving`;
}

