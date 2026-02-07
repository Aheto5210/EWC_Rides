import http from "node:http";
import https from "node:https";
import { randomUUID, randomBytes } from "node:crypto";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3331);
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, "..", "public");

const ROOM_CODE = (process.env.ROOM_CODE ?? "").trim() || null;
const DRIVER_DB_FILE = path.join(__dirname, "data", "ewc.sqlite");
const MAX_JSON_BODY_BYTES = clampNumber(Number(process.env.MAX_JSON_BODY_BYTES ?? 32_768), 1024, 1_048_576);
const DRIVER_SESSION_TTL_MS =
  clampNumber(Number(process.env.DRIVER_SESSION_TTL_DAYS ?? 14), 1, 180) *
  24 *
  60 *
  60 *
  1_000;
const MAX_PICKUP_MINUTES = clampNumber(
  Number(process.env.MAX_PICKUP_MINUTES ?? 10),
  1,
  60,
);
const ASSUMED_SPEED_KMH = clampNumber(
  Number(process.env.ASSUMED_SPEED_KMH ?? 40),
  5,
  120,
);
const MAX_PICKUP_DISTANCE_KM = clampNumber(
  Number(
    process.env.MAX_PICKUP_DISTANCE_KM ??
      (ASSUMED_SPEED_KMH * MAX_PICKUP_MINUTES) / 60,
  ),
  0.1,
  50,
);
const MAX_PICKUP_MINUTES_EFFECTIVE = Math.round(
  ((MAX_PICKUP_DISTANCE_KM / ASSUMED_SPEED_KMH) * 60) * 10,
) / 10;
const MAX_ACTIVE_REQUESTS_PER_DRIVER = clampNumber(
  Number(process.env.MAX_ACTIVE_REQUESTS_PER_DRIVER ?? 3),
  1,
  20,
);
const REQUEST_TTL_MS = clampNumber(
  Number(process.env.REQUEST_TTL_MINUTES ?? 5),
  1,
  180,
) * 60_000;
const DRIVER_STALE_MS = clampNumber(
  Number(process.env.DRIVER_STALE_SECONDS ?? 45),
  10,
  300,
) * 1_000;
// Consider a driver "active" for phone-reservation purposes only if we've seen a recent heartbeat.
// (This allows registered drivers to request rides with their own number once they're no longer active.)
const DRIVER_PHONE_ACTIVE_MS = Math.min(DRIVER_STALE_MS, 25_000);
const RIDER_SNAPSHOT_INTERVAL_MS = clampNumber(
  Number(process.env.RIDER_SNAPSHOT_SECONDS ?? 10),
  3,
  60,
) * 1_000;
const DRIVER_BROADCAST_MIN_MS = clampNumber(
  Number(process.env.DRIVER_BROADCAST_MIN_MS ?? 5000),
  500,
  60_000,
);
const DRIVER_BROADCAST_MIN_MOVE_M = clampNumber(
  Number(process.env.DRIVER_BROADCAST_MIN_MOVE_M ?? 30),
  0,
  500,
);
const ASSIGNED_TTL_MS = clampNumber(
  Number(process.env.ASSIGNED_TTL_MINUTES ?? 180),
  15,
  24 * 60,
) * 60_000;

// Static response caching (server-side). Nginx can handle this too, but keeping a small in-memory
// cache helps on smaller VPS disks and reduces filesystem churn.
const STATIC_CACHE_MAX_BYTES = clampNumber(
  Number(process.env.STATIC_CACHE_MAX_BYTES ?? 8 * 1024 * 1024),
  0,
  64 * 1024 * 1024,
);
const STATIC_CACHE_MAX_FILE_BYTES = clampNumber(
  Number(process.env.STATIC_CACHE_MAX_FILE_BYTES ?? 512 * 1024),
  0,
  5 * 1024 * 1024,
);

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  res.end(payload);
}

function parseCookies(req) {
  const header = (req.headers?.cookie ?? "").toString();
  if (!header) return {};
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(String(value))}`];
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.maxAgeSeconds) parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`);
  parts.push(`SameSite=${opts.sameSite || "Lax"}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  const cookie = parts.join("; ");
  const prev = res.getHeader("Set-Cookie");
  if (!prev) res.setHeader("Set-Cookie", cookie);
  else if (Array.isArray(prev)) res.setHeader("Set-Cookie", [...prev, cookie]);
  else res.setHeader("Set-Cookie", [String(prev), cookie]);
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length || 0;
    if (total > MAX_JSON_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req) {
  let raw = "";
  try {
    raw = await readBody(req);
  } catch (e) {
    if (e && e.message === "BODY_TOO_LARGE") return { __tooLarge: true };
    throw e;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getSearchParams(reqUrl) {
  try {
    const url = new URL(reqUrl, "http://localhost");
    return url.searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function requireRoomCodeOr401(providedCode, res) {
  if (!ROOM_CODE) return true;
  if (providedCode && providedCode === ROOM_CODE) return true;
  json(res, 401, { error: "ROOM_CODE_REQUIRED" });
  return false;
}

function metersToKm(meters) {
  return meters / 1000;
}

function haversineKm(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

function nowMs() {
  return Date.now();
}

function sanitizeRoom(room) {
  const trimmed = (room ?? "").toString().trim().toLowerCase();
  if (!trimmed) return "ewc";
  return trimmed.replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "ewc";
}

function sanitizeName(name) {
  const trimmed = (name ?? "").toString().trim();
  if (!trimmed) return "Member";
  return trimmed.slice(0, 32);
}

function digitsOnly(value) {
  return (value ?? "").toString().replace(/\D/g, "");
}

function sanitizePhone(phone) {
  const digits = digitsOnly(phone).slice(0, 15);
  return digits;
}

function isValidPhone(phoneDigits) {
  return typeof phoneDigits === "string" && phoneDigits.length >= 7;
}

function last4(phoneDigits) {
  const d = digitsOnly(phoneDigits);
  return d.slice(Math.max(0, d.length - 4));
}

function isDriverCodeInUse(code, exceptPhone = "") {
  const c = digitsOnly(code).slice(0, 4);
  if (c.length !== 4) return false;
  const row = dbGetDriverByCode(c);
  if (!row) return false;
  if (exceptPhone && row.phone === exceptPhone) return false;
  return true;
}

function makeToken() {
  return randomBytes(24).toString("base64url");
}

async function ensureDir(dir) {
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {
    // ignore
  }
}

await ensureDir(path.dirname(DRIVER_DB_FILE));
const db = new Database(DRIVER_DB_FILE, { fileMustExist: false });
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("busy_timeout = 5000");
db.pragma("temp_store = MEMORY");
// A modest cache helps reduce IO on VPS disks.
try {
  db.pragma("cache_size = -4000"); // ~4MB
} catch {
  // ignore
}
db.exec(`
  CREATE TABLE IF NOT EXISTS drivers (
    phone TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS online_drivers (
    room TEXT NOT NULL,
    driver_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    lat REAL,
    lng REAL,
    accuracy_m REAL,
    heading REAL,
    speed_mps REAL,
    updated_at INTEGER NOT NULL,
    last_broadcast_at INTEGER NOT NULL,
    PRIMARY KEY (room, driver_id)
  );
`);

// Backfill schema for older databases.
try {
  const cols = db.prepare("PRAGMA table_info(online_drivers)").all();
  const hasPhone = Array.isArray(cols) && cols.some((c) => String(c?.name) === "phone");
  if (!hasPhone) db.exec("ALTER TABLE online_drivers ADD COLUMN phone TEXT;");
} catch {
  // ignore
}

db.exec(`
  CREATE TABLE IF NOT EXISTS ride_requests (
    id TEXT PRIMARY KEY,
    room TEXT NOT NULL,
    rider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    rider_phone TEXT,
    note TEXT,
    status TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    created_at INTEGER NOT NULL,
    target_driver_id TEXT,
    target_driver_name TEXT,
    assigned_driver_id TEXT,
    assigned_driver_name TEXT,
    assigned_driver_phone TEXT
  );
`);

db.exec("CREATE INDEX IF NOT EXISTS idx_online_drivers_room_updated ON online_drivers(room, updated_at);");
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_ride_requests_room_status_created ON ride_requests(room, status, created_at);",
);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_ride_requests_room_rider_status ON ride_requests(room, rider_id, status);",
);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_ride_requests_room_target_status ON ride_requests(room, target_driver_id, status);",
);

function dbGetDriverByPhone(phone) {
  return (
    db
      .prepare(
        "SELECT phone, code, name, created_at AS createdAt, updated_at AS updatedAt FROM drivers WHERE phone = ?",
      )
      .get(phone) ?? null
  );
}

function dbGetDriverByCode(code) {
  return (
    db
      .prepare(
        "SELECT phone, code, name, created_at AS createdAt, updated_at AS updatedAt FROM drivers WHERE code = ?",
      )
      .get(code) ?? null
  );
}

function dbInsertDriver({ phone, code, name, now }) {
  db.prepare(
    "INSERT INTO drivers (phone, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(phone, code, name, now, now);
}

function dbCountDrivers() {
  const row = db.prepare("SELECT COUNT(1) AS n FROM drivers").get();
  return Number(row?.n ?? 0);
}

function dbUpsertOnlineDriver({
  room,
  driverId,
  name,
  phone = "",
  lat = null,
  lng = null,
  accuracyM = null,
  heading = null,
  speedMps = null,
  updatedAt,
  lastBroadcastAt,
}) {
  db.prepare(
    `
    INSERT INTO online_drivers
      (room, driver_id, name, phone, lat, lng, accuracy_m, heading, speed_mps, updated_at, last_broadcast_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(room, driver_id) DO UPDATE SET
      name = excluded.name,
      phone = excluded.phone,
      lat = excluded.lat,
      lng = excluded.lng,
      accuracy_m = excluded.accuracy_m,
      heading = excluded.heading,
      speed_mps = excluded.speed_mps,
      updated_at = excluded.updated_at,
      last_broadcast_at = excluded.last_broadcast_at
  `,
  ).run(
    room,
    driverId,
    name,
    phone,
    lat,
    lng,
    accuracyM,
    heading,
    speedMps,
    updatedAt,
    lastBroadcastAt,
  );
}

function dbDeleteOnlineDriver(room, driverId) {
  db.prepare("DELETE FROM online_drivers WHERE room = ? AND driver_id = ?").run(room, driverId);
}

function dbUpsertRideRequest(room, req) {
  db.prepare(
    `
    INSERT INTO ride_requests
      (id, room, rider_id, name, rider_phone, note, status, lat, lng, created_at,
       target_driver_id, target_driver_name, assigned_driver_id, assigned_driver_name, assigned_driver_phone)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      target_driver_id = excluded.target_driver_id,
      target_driver_name = excluded.target_driver_name,
      assigned_driver_id = excluded.assigned_driver_id,
      assigned_driver_name = excluded.assigned_driver_name,
      assigned_driver_phone = excluded.assigned_driver_phone
  `,
  ).run(
    req.id,
    room,
    req.riderId,
    req.name,
    req.riderPhone ?? "",
    req.note ?? "",
    req.status,
    req.lat,
    req.lng,
    req.createdAt,
    req.targetDriverId ?? null,
    req.targetDriverName ?? null,
    req.assignedDriverId ?? null,
    req.assignedDriverName ?? null,
    req.assignedDriverPhone ?? "",
  );
}

function dbDeleteRideRequest(id) {
  db.prepare("DELETE FROM ride_requests WHERE id = ?").run(id);
}

function hydratePersistedState() {
  const now = nowMs();
  const drivers = db
    .prepare(
      "SELECT room, driver_id AS driverId, name, phone, lat, lng, accuracy_m AS accuracyM, heading, speed_mps AS speedMps, updated_at AS updatedAt, last_broadcast_at AS lastBroadcastAt FROM online_drivers",
    )
    .all();
  for (const d of drivers) {
    if (!d?.room || !d?.driverId) continue;
    if (Number(d.updatedAt || 0) < now - DRIVER_STALE_MS) continue;
    const { state: roomState } = getRoomState(d.room);
    roomState.drivers.set(d.driverId, {
      id: d.driverId,
      name: sanitizeName(d.name),
      phone: sanitizePhone(d.phone),
      available: true,
      last: Number.isFinite(Number(d.lat)) && Number.isFinite(Number(d.lng))
        ? {
            lat: Number(d.lat),
            lng: Number(d.lng),
            accuracyM: Number.isFinite(Number(d.accuracyM)) ? Number(d.accuracyM) : null,
            heading: Number.isFinite(Number(d.heading)) ? Number(d.heading) : null,
            speedMps: Number.isFinite(Number(d.speedMps)) ? Number(d.speedMps) : null,
            updatedAt: Number(d.updatedAt),
          }
        : null,
      updatedAt: Number(d.updatedAt || 0),
      lastBroadcastAt: Number(d.lastBroadcastAt || 0),
    });
  }

  const reqs = db
    .prepare(
      "SELECT id, room, rider_id AS riderId, name, rider_phone AS riderPhone, note, status, lat, lng, created_at AS createdAt, target_driver_id AS targetDriverId, target_driver_name AS targetDriverName, assigned_driver_id AS assignedDriverId, assigned_driver_name AS assignedDriverName, assigned_driver_phone AS assignedDriverPhone FROM ride_requests",
    )
    .all();
  for (const r of reqs) {
    if (!r?.room || !r?.id) continue;
    const createdAt = Number(r.createdAt || 0);
    if (r.status === "pending" && createdAt < now - REQUEST_TTL_MS) {
      dbDeleteRideRequest(r.id);
      continue;
    }
    if (r.status === "assigned" && createdAt < now - ASSIGNED_TTL_MS) {
      dbDeleteRideRequest(r.id);
      continue;
    }
    const { state: roomState } = getRoomState(r.room);
    const req = {
      id: String(r.id),
      riderId: String(r.riderId),
      name: sanitizeName(r.name),
      riderPhone: sanitizePhone(r.riderPhone),
      note: String(r.note ?? ""),
      status: String(r.status),
      lat: Number(r.lat),
      lng: Number(r.lng),
      createdAt,
      targetDriverId: r.targetDriverId ? String(r.targetDriverId) : null,
      targetDriverName: r.targetDriverName ? String(r.targetDriverName) : null,
      assignedDriverId: r.assignedDriverId ? String(r.assignedDriverId) : null,
      assignedDriverName: r.assignedDriverName ? String(r.assignedDriverName) : null,
      assignedDriverPhone: sanitizePhone(r.assignedDriverPhone),
    };
    roomState.requests.set(req.id, req);
    if (req.status === "assigned") indexAssigned(roomState, req);
  }
}

const driverSessions = new Map(); // token -> { phone, name, createdAt, expiresAt }

function getAuthToken(req, fallbackFromBody = null) {
  const hdr = (req.headers?.authorization ?? "").toString().trim();
  if (hdr.toLowerCase().startsWith("bearer ")) return hdr.slice(7).trim();
  const tokenFromBody =
    fallbackFromBody && typeof fallbackFromBody.token !== "undefined"
      ? String(fallbackFromBody.token)
      : "";
  return tokenFromBody.trim();
}

function requireDriverSession(req, res, body = null) {
  const token = getAuthToken(req, body);
  if (!token) {
    json(res, 401, { error: "DRIVER_AUTH_REQUIRED" });
    return null;
  }
  const session = driverSessions.get(token);
  if (!session) {
    json(res, 401, { error: "DRIVER_AUTH_INVALID" });
    return null;
  }
  if (session.expiresAt && session.expiresAt < nowMs()) {
    driverSessions.delete(token);
    json(res, 401, { error: "DRIVER_AUTH_EXPIRED" });
    return null;
  }
  return { token, session };
}

function pickLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries ?? []) {
      if (!net) continue;
      if (net.family !== "IPv4") continue;
      if (net.internal) continue;
      candidates.push(net.address);
    }
  }
  const preferred = candidates.find(
    (ip) => ip.startsWith("192.168.") || ip.startsWith("10.") || ip.startsWith("172."),
  );
  return preferred ?? candidates[0] ?? null;
}

function isValidLatLng(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

function makeRoomState() {
  return {
    roomId: "ewc",
    drivers: new Map(), // driverId -> driver
    requests: new Map(), // requestId -> request
    subscribers: new Set(), // sse clients
    assignedRidersByDriver: new Map(), // driverId -> Set<riderId>
    snapshotCache: { at: 0, drivers: [] },
  };
}

function indexAssigned(roomState, request) {
  const driverId = request?.assignedDriverId;
  const riderId = request?.riderId;
  if (!driverId || !riderId) return;
  let set = roomState.assignedRidersByDriver.get(driverId);
  if (!set) {
    set = new Set();
    roomState.assignedRidersByDriver.set(driverId, set);
  }
  set.add(riderId);
}

function unindexAssigned(roomState, request) {
  const driverId = request?.assignedDriverId;
  const riderId = request?.riderId;
  if (!driverId || !riderId) return;
  const set = roomState.assignedRidersByDriver.get(driverId);
  if (!set) return;
  set.delete(riderId);
  if (set.size === 0) roomState.assignedRidersByDriver.delete(driverId);
}

const rooms = new Map(); // roomId -> roomState

function getRoomState(roomId) {
  const id = sanitizeRoom(roomId);
  let state = rooms.get(id);
  if (!state) {
    state = makeRoomState();
    state.roomId = id;
    rooms.set(id, state);
  }
  return { id, state };
}

hydratePersistedState();

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseKeepAlive(res) {
  res.write(`event: ping\n`);
  res.write(`data: ${nowMs()}\n\n`);
}

function sendSnapshot(subscriber, roomId, roomState) {
  const now = nowMs();
  // Cache driver payload briefly so hundreds of rider snapshots don't re-serialize the same list.
  if (!roomState.snapshotCache || now - Number(roomState.snapshotCache.at || 0) > 750) {
    const drivers = [];
    for (const driver of roomState.drivers.values()) {
      if (!driver.available) continue;
      if (!driver.last) continue;
      drivers.push(publicDriver(driver));
    }
    roomState.snapshotCache = { at: now, drivers };
  }

  const payload = {
    room: roomId,
    now,
    config: {
      maxPickupDistanceKm: MAX_PICKUP_DISTANCE_KM,
      maxPickupMinutes: MAX_PICKUP_MINUTES_EFFECTIVE,
      assumedSpeedKmh: ASSUMED_SPEED_KMH,
      maxActiveRequestsPerDriver: MAX_ACTIVE_REQUESTS_PER_DRIVER,
      requestTtlMinutes: Math.round(REQUEST_TTL_MS / 60_000),
      driverStaleSeconds: Math.round(DRIVER_STALE_MS / 1_000),
      roomCodeRequired: Boolean(ROOM_CODE),
    },
    drivers: roomState.snapshotCache.drivers,
    requests: [],
  };

  if (subscriber.role === "driver") {
    payload.requests = visibleRequestsForDriver(roomState, subscriber.deviceId);
  }

  if (subscriber.role === "rider") {
    const active = findActiveRequestForRider(roomState, subscriber.deviceId);
    if (active) payload.requests = [publicRequest(active)];
  }

  sseWrite(subscriber.res, "snapshot", payload);
}

function publicDriver(driver) {
  return {
    id: driver.id,
    name: driver.name,
    last: driver.last
      ? {
          lat: driver.last.lat,
          lng: driver.last.lng,
          accuracyM: driver.last.accuracyM ?? null,
          heading: driver.last.heading ?? null,
          speedMps: driver.last.speedMps ?? null,
          updatedAt: driver.last.updatedAt,
        }
      : null,
  };
}

function publicRequest(request) {
  return {
    id: request.id,
    riderId: request.riderId,
    name: request.name,
    riderPhone: request.riderPhone ?? "",
    note: request.note ?? "",
    status: request.status,
    lat: request.lat,
    lng: request.lng,
    createdAt: request.createdAt,
    targetDriverId: request.targetDriverId ?? null,
    targetDriverName: request.targetDriverName ?? null,
    assignedDriverId: request.assignedDriverId ?? null,
    assignedDriverName: request.assignedDriverName ?? null,
    assignedDriverPhone: request.assignedDriverPhone ?? "",
  };
}

function findActiveRequestForRider(roomState, riderId) {
  for (const req of roomState.requests.values()) {
    if (req.riderId !== riderId) continue;
    if (req.status === "pending") return req;
  }
  return null;
}

function visibleRequestsForDriver(roomState, driverId) {
  const results = [];
  for (const req of roomState.requests.values()) {
    if (req.targetDriverId !== driverId) continue;
    if (req.status !== "pending" && req.status !== "assigned") continue;
    results.push(publicRequest(req));
  }
  results.sort((a, b) => a.createdAt - b.createdAt);
  return results;
}

function countActiveRequestsForDriver(roomState, driverId) {
  let count = 0;
  for (const req of roomState.requests.values()) {
    if (req.targetDriverId !== driverId) continue;
    if (req.status !== "pending" && req.status !== "assigned") continue;
    count += 1;
  }
  return count;
}

function isRiderPhoneInUse(roomState, riderPhone, exceptRiderId = "") {
  const phone = sanitizePhone(riderPhone);
  if (!phone) return false;
  for (const req of roomState.requests.values()) {
    if (!req) continue;
    if (req.status !== "pending" && req.status !== "assigned") continue;
    if (exceptRiderId && req.riderId === exceptRiderId) continue;
    if (sanitizePhone(req.riderPhone) === phone) return true;
  }
  return false;
}

function isRegisteredDriverOnlineInRoom(roomState, phoneDigits) {
  const phone = sanitizePhone(phoneDigits);
  if (!phone) return false;
  const cutoff = nowMs() - DRIVER_PHONE_ACTIVE_MS;
  for (const d of roomState.drivers.values()) {
    if (!d) continue;
    if (!d.available) continue;
    if (!sanitizePhone(d.phone)) continue;
    if (sanitizePhone(d.phone) !== phone) continue;
    const updatedAt = Number(d.last?.updatedAt ?? d.updatedAt ?? 0);
    if (!updatedAt || updatedAt < cutoff) continue;
    return true;
  }
  return false;
}

function pickBestDriver(roomState, riderLat, riderLng) {
  let best = null;
  for (const d of roomState.drivers.values()) {
    if (!d.available) continue;
    if (!d.last) continue;
    const activeCount = countActiveRequestsForDriver(roomState, d.id);
    if (activeCount >= MAX_ACTIVE_REQUESTS_PER_DRIVER) continue;
    const distKm = haversineKm(d.last.lat, d.last.lng, riderLat, riderLng);
    if (distKm > MAX_PICKUP_DISTANCE_KM) continue;
    const eta = (distKm / ASSUMED_SPEED_KMH) * 60;
    if (!Number.isFinite(eta)) continue;
    if (!best || eta < best.eta) best = { driver: d, eta };
  }
  return best;
}

function eachSubscriber(roomState, fn) {
  for (const sub of roomState.subscribers) {
    try {
      fn(sub);
    } catch {
      // ignore
    }
  }
}

function sendDriverUpdate(roomState, driver) {
  const payload = publicDriver(driver);
  eachSubscriber(roomState, (sub) => {
    if (sub.role === "driver") {
      sseWrite(sub.res, "driver:update", payload);
      return;
    }
    if (sub.role !== "rider") return;
    const riderIds = roomState.assignedRidersByDriver.get(driver.id);
    if (!riderIds) return;
    if (!riderIds.has(sub.deviceId)) return;
    sseWrite(sub.res, "driver:update", payload);
  });
}

function sendDriverRemove(roomState, driverId) {
  eachSubscriber(roomState, (sub) => {
    if (sub.role !== "driver" && sub.role !== "rider") return;
    sseWrite(sub.res, "driver:remove", { id: driverId });
  });
}

function sendRequestUpdate(roomState, request, eventName) {
  const payload = publicRequest(request);

  eachSubscriber(roomState, (sub) => {
    if (sub.role === "rider" && sub.deviceId === request.riderId) {
      sseWrite(sub.res, eventName, payload);
    }
  });

  eachSubscriber(roomState, (sub) => {
    if (sub.role !== "driver") return;
    if (sub.deviceId !== request.targetDriverId) return;
    sseWrite(sub.res, eventName, payload);
  });
}

function sendRequestRemove(roomState, request, reason = null) {
  const requestId = request.id;
  const riderId = request.riderId;
  const targetDriverId = request.targetDriverId;
  const payload = { id: requestId, reason: reason ? String(reason) : null };

  eachSubscriber(roomState, (sub) => {
    if (sub.role !== "driver") return;
    if (targetDriverId && sub.deviceId !== targetDriverId) return;
    sseWrite(sub.res, "request:remove", payload);
  });

  eachSubscriber(roomState, (sub) => {
    if (sub.role !== "rider") return;
    if (sub.deviceId !== riderId) return;
    sseWrite(sub.res, "request:remove", payload);
  });
}

function cleanupStale() {
  const cutoffDriver = nowMs() - DRIVER_STALE_MS;
  const cutoffRequest = nowMs() - REQUEST_TTL_MS;
  const cutoffAssigned = nowMs() - ASSIGNED_TTL_MS;

  for (const [roomId, roomState] of rooms.entries()) {
    for (const [driverId, driver] of roomState.drivers.entries()) {
      if (!driver.available) continue;
      const updatedAt = Number(driver.last?.updatedAt ?? driver.updatedAt ?? 0);
      if (updatedAt >= cutoffDriver) continue;
      driver.available = false;
      roomState.drivers.delete(driverId);
      try {
        dbDeleteOnlineDriver(roomId, driverId);
      } catch {
        // ignore
      }
      sendDriverRemove(roomState, driverId);
    }

    for (const [requestId, req] of roomState.requests.entries()) {
      if (req.status === "pending") {
        if (req.createdAt >= cutoffRequest) continue;
        roomState.requests.delete(requestId);
        try {
          dbDeleteRideRequest(requestId);
        } catch {
          // ignore
        }
        sendRequestRemove(roomState, req, "expired");
        continue;
      }
      if (req.status === "assigned") {
        if (req.createdAt >= cutoffAssigned) continue;
        unindexAssigned(roomState, req);
        roomState.requests.delete(requestId);
        try {
          dbDeleteRideRequest(requestId);
        } catch {
          // ignore
        }
        sendRequestRemove(roomState, req, "stale");
      }
    }
  }

  // DB cleanup (for rooms not currently in memory).
  try {
    db.prepare("DELETE FROM online_drivers WHERE updated_at < ?").run(cutoffDriver);
    db.prepare("DELETE FROM ride_requests WHERE status = 'pending' AND created_at < ?").run(cutoffRequest);
    db.prepare("DELETE FROM ride_requests WHERE status = 'assigned' AND created_at < ?").run(cutoffAssigned);
  } catch {
    // ignore
  }
}

setInterval(cleanupStale, 5_000).unref();

const staticCache = new Map(); // filePath -> { etag, data, contentType, cacheControl }
let staticCacheBytes = 0;

async function serveStatic(req, res) {
  const reqUrl = req.url ?? "/";
  const url = new URL(reqUrl, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".mp3": "audio/mpeg",
      ".png": "image/png",
      ".ico": "image/x-icon",
    }[ext];
    const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;

    const inm = (req.headers["if-none-match"] ?? "").toString();
    if (inm && inm === etag) {
      res.writeHead(304, {
        etag,
        "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600",
      });
      res.end();
      return;
    }

    const cacheControl =
      pathname === "/sw.js"
        ? "no-cache"
        : ext === ".html"
          ? "no-store"
          : "public, max-age=3600";

    const cached = STATIC_CACHE_MAX_BYTES > 0 ? staticCache.get(filePath) : null;
    if (cached && cached.etag === etag) {
      res.writeHead(200, {
        "content-type": cached.contentType ?? "application/octet-stream",
        "content-length": cached.data.length,
        etag,
        "cache-control": cached.cacheControl,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      res.end(cached.data);
      return;
    }

    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "content-type": contentType ?? "application/octet-stream",
      "content-length": data.length,
      etag,
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    res.end(data);

    if (
      STATIC_CACHE_MAX_BYTES > 0 &&
      data.length > 0 &&
      data.length <= STATIC_CACHE_MAX_FILE_BYTES &&
      cacheControl !== "no-store"
    ) {
      const prev = staticCache.get(filePath);
      if (!prev) staticCacheBytes += data.length;
      staticCache.set(filePath, { etag, data, contentType, cacheControl });
      while (staticCacheBytes > STATIC_CACHE_MAX_BYTES && staticCache.size) {
        const [firstKey, firstVal] = staticCache.entries().next().value;
        staticCache.delete(firstKey);
        staticCacheBytes -= firstVal?.data?.length ?? 0;
      }
    }
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const requestHandler = async (req, res) => {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  if (url.startsWith("/api/health") && method === "GET") {
    json(res, 200, { ok: true, now: nowMs() });
    return;
  }

  if (url.startsWith("/api/config") && method === "GET") {
    json(res, 200, {
      roomCodeRequired: Boolean(ROOM_CODE),
      maxPickupDistanceKm: MAX_PICKUP_DISTANCE_KM,
      maxPickupMinutes: MAX_PICKUP_MINUTES_EFFECTIVE,
      assumedSpeedKmh: ASSUMED_SPEED_KMH,
      maxActiveRequestsPerDriver: MAX_ACTIVE_REQUESTS_PER_DRIVER,
      requestTtlMinutes: Math.round(REQUEST_TTL_MS / 60_000),
      driverStaleSeconds: Math.round(DRIVER_STALE_MS / 1_000),
      daysOpen: ["Tuesday", "Thursday", "Sunday"],
    });
    return;
  }

  if (url.startsWith("/api/stream") && method === "GET") {
    const sp = getSearchParams(url);
    const room = sanitizeRoom(sp.get("room"));
    const role = sp.get("role") === "driver" ? "driver" : "rider";
    const deviceId = (sp.get("id") ?? "").trim().slice(0, 80);
    const code = (sp.get("code") ?? "").trim();
    const token = (sp.get("token") ?? "").trim();

    if (!requireRoomCodeOr401(code, res)) return;
    if (!deviceId) {
      json(res, 400, { error: "MISSING_ID" });
      return;
    }
    if (role === "driver") {
      const session = driverSessions.get(token);
      if (!token || !session) {
        json(res, 401, { error: "DRIVER_AUTH_REQUIRED" });
        return;
      }
      if (session.expiresAt && session.expiresAt < nowMs()) {
        driverSessions.delete(token);
        json(res, 401, { error: "DRIVER_AUTH_EXPIRED" });
        return;
      }
    }

    const { id: roomId, state: roomState } = getRoomState(room);

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    res.write("\n");

    const subscriber = {
      id: randomUUID(),
      roomId,
      role,
      deviceId,
      res,
      createdAt: nowMs(),
    };
    roomState.subscribers.add(subscriber);

    sendSnapshot(subscriber, roomId, roomState);

    const keepAlive = setInterval(() => sseKeepAlive(res), 15_000);
    keepAlive.unref();
    const riderSnapshot =
      role === "rider"
        ? setInterval(() => sendSnapshot(subscriber, roomId, roomState), RIDER_SNAPSHOT_INTERVAL_MS)
        : null;
    riderSnapshot?.unref?.();

    req.on("close", () => {
      clearInterval(keepAlive);
      if (riderSnapshot) clearInterval(riderSnapshot);
      roomState.subscribers.delete(subscriber);
    });
    return;
  }

  if (url.startsWith("/api/auth/driver/register") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });

    const name = sanitizeName(body.name);
    const phone = sanitizePhone(body.phone);
    if (!name) return json(res, 400, { error: "MISSING_NAME" });
    if (!isValidPhone(phone)) return json(res, 400, { error: "INVALID_PHONE" });

    const now = nowMs();
    if (dbGetDriverByPhone(phone)) {
      json(res, 409, { error: "PHONE_IN_USE" });
      return;
    }

    const code = last4(phone);
    if (isDriverCodeInUse(code, phone)) {
      json(res, 409, { error: "CODE_IN_USE" });
      return;
    }

    try {
      dbInsertDriver({ phone, code, name, now });
    } catch {
      // If another registration raced us.
      if (dbGetDriverByPhone(phone)) return json(res, 409, { error: "PHONE_IN_USE" });
      if (dbGetDriverByCode(code)) return json(res, 409, { error: "CODE_IN_USE" });
      return json(res, 500, { error: "REGISTER_FAILED" });
    }

    setCookie(res, "ewc_driver_phone", phone, {
      maxAgeSeconds: Math.floor(DRIVER_SESSION_TTL_MS / 1_000),
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    });

    json(res, 201, {
      ok: true,
      driver: { name, phoneLast4: last4(phone) },
      code,
    });
    return;
  }

  if (url.startsWith("/api/auth/driver/login") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });

    const code = digitsOnly(body.code).slice(0, 4);
    if (!code || code.length !== 4) return json(res, 400, { error: "INVALID_CODE" });

    const record = dbGetDriverByCode(code);
    if (!record) return json(res, 404, { error: "DRIVER_NOT_REGISTERED" });
    const phone = sanitizePhone(record.phone);

    const token = makeToken();
    const now = nowMs();
    driverSessions.set(token, {
      phone,
      name: record.name,
      createdAt: now,
      expiresAt: now + DRIVER_SESSION_TTL_MS,
    });

    setCookie(res, "ewc_driver_phone", phone, {
      maxAgeSeconds: Math.floor(DRIVER_SESSION_TTL_MS / 1_000),
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    });

    json(res, 200, {
      ok: true,
      token,
      driver: { name: record.name, phone, phoneLast4: code },
    });
    return;
  }

  if (url.startsWith("/api/auth/driver/me") && method === "GET") {
    const auth = requireDriverSession(req, res);
    if (!auth) return;
    const { phone, name } = auth.session;
    json(res, 200, { ok: true, driver: { name, phone, phoneLast4: last4(phone) } });
    return;
  }

  if (url.startsWith("/api/driver/start") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });
    if (!requireRoomCodeOr401(body.code, res)) return;
    const auth = requireDriverSession(req, res, body);
    if (!auth) return;

    const room = sanitizeRoom(body.room);
    const driverId = (body.driverId ?? "").toString().trim().slice(0, 80);
    if (!driverId) return json(res, 400, { error: "MISSING_DRIVER_ID" });
    const name = sanitizeName(auth.session.name);

    const { state: roomState } = getRoomState(room);
    const existing = roomState.drivers.get(driverId);
    const now = nowMs();
    const driver = existing ?? {
      id: driverId,
      name,
      phone: sanitizePhone(auth.session.phone),
      available: true,
      last: null,
      updatedAt: now,
      lastBroadcastAt: 0,
    };
    driver.name = name;
    driver.phone = sanitizePhone(auth.session.phone);
    driver.available = true;
    driver.updatedAt = now;
    driver.lastBroadcastAt = 0;
    roomState.drivers.set(driverId, driver);

    dbUpsertOnlineDriver({
      room,
      driverId,
      name: driver.name,
      phone: driver.phone,
      updatedAt: now,
      lastBroadcastAt: Number(driver.lastBroadcastAt || 0),
    });

    sendDriverUpdate(roomState, driver);
    json(res, 200, { ok: true });
    return;
  }

  if (url.startsWith("/api/driver/update") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });
    if (!requireRoomCodeOr401(body.code, res)) return;
    const auth = requireDriverSession(req, res, body);
    if (!auth) return;

    const room = sanitizeRoom(body.room);
    const driverId = (body.driverId ?? "").toString().trim().slice(0, 80);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!driverId) return json(res, 400, { error: "MISSING_DRIVER_ID" });
    if (!isValidLatLng(lat, lng)) return json(res, 400, { error: "INVALID_LAT_LNG" });

    const accuracyM = Number.isFinite(Number(body.accuracyM)) ? Number(body.accuracyM) : null;
    const heading = Number.isFinite(Number(body.heading)) ? Number(body.heading) : null;
    const speedMps = Number.isFinite(Number(body.speedMps)) ? Number(body.speedMps) : null;

    const { state: roomState } = getRoomState(room);
    const existing = roomState.drivers.get(driverId);
    const driver = existing ?? {
      id: driverId,
      name: sanitizeName(auth.session.name),
      phone: sanitizePhone(auth.session.phone),
      available: true,
      last: null,
      updatedAt: nowMs(),
      lastBroadcastAt: 0,
    };

    const prev = driver.last;
    const prevLat = prev?.lat;
    const prevLng = prev?.lng;
    driver.available = true;
    driver.name = sanitizeName(auth.session.name ?? driver.name);
    driver.phone = sanitizePhone(auth.session.phone ?? driver.phone);
    driver.updatedAt = nowMs();
    driver.last = {
      lat,
      lng,
      accuracyM,
      heading,
      speedMps,
      updatedAt: nowMs(),
    };
    roomState.drivers.set(driverId, driver);

    const now = driver.last.updatedAt;
    const lastBroadcastAt = Number(driver.lastBroadcastAt || 0);
    const since = now - lastBroadcastAt;
    let movedM = Infinity;
    if (isValidLatLng(Number(prevLat), Number(prevLng))) {
      movedM = haversineKm(prevLat, prevLng, lat, lng) * 1000;
    }
    const shouldBroadcast =
      lastBroadcastAt === 0 ||
      since >= DRIVER_BROADCAST_MIN_MS ||
      (Number.isFinite(movedM) && movedM >= DRIVER_BROADCAST_MIN_MOVE_M);

    if (shouldBroadcast) {
      driver.lastBroadcastAt = now;
      sendDriverUpdate(roomState, driver);
    }

    dbUpsertOnlineDriver({
      room,
      driverId,
      name: driver.name,
      phone: driver.phone,
      lat,
      lng,
      accuracyM,
      heading,
      speedMps,
      updatedAt: now,
      lastBroadcastAt: Number(driver.lastBroadcastAt || 0),
    });
    json(res, 200, { ok: true });
    return;
  }

  if (url.startsWith("/api/driver/stop") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });
    if (!requireRoomCodeOr401(body.code, res)) return;
    const auth = requireDriverSession(req, res, body);
    if (!auth) return;

    const room = sanitizeRoom(body.room);
    const driverId = (body.driverId ?? "").toString().trim().slice(0, 80);
    if (!driverId) return json(res, 400, { error: "MISSING_DRIVER_ID" });

    const { state: roomState } = getRoomState(room);
    roomState.drivers.delete(driverId);
    dbDeleteOnlineDriver(room, driverId);
    sendDriverRemove(roomState, driverId);
    json(res, 200, { ok: true });
    return;
  }

  if (url.startsWith("/api/ride/request") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });
    if (!requireRoomCodeOr401(body.code, res)) return;

    const room = sanitizeRoom(body.room);
    const riderId = (body.riderId ?? "").toString().trim().slice(0, 80);
    if (!riderId) return json(res, 400, { error: "MISSING_RIDER_ID" });

    const { state: roomState } = getRoomState(room);
    const existing = findActiveRequestForRider(roomState, riderId);
    if (existing) {
      json(res, 200, { ok: true, request: publicRequest(existing) });
      return;
    }

    const name = sanitizeName(body.name);
    const riderPhone = sanitizePhone(body.phone ?? body.riderPhone);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    let targetDriverId = (body.targetDriverId ?? "").toString().trim().slice(0, 80);
    const note = (body.note ?? "").toString().trim().slice(0, 120);
    if (!isValidPhone(riderPhone)) return json(res, 400, { error: "INVALID_RIDER_PHONE" });
    if (!isValidLatLng(lat, lng)) return json(res, 400, { error: "INVALID_LAT_LNG" });

    const registeredDriver = dbGetDriverByPhone(riderPhone);
    const registeredDriverActive = registeredDriver
      ? isRegisteredDriverOnlineInRoom(roomState, riderPhone)
      : false;

    // Block using an active driver's phone number for a rider request.
    if (registeredDriverActive) {
      json(res, 409, { error: "RIDER_PHONE_RESERVED" });
      return;
    }

    // Prevent two different devices from using the same rider phone for concurrent active requests.
    // Allow registered drivers to request rides with their own phone when they're not actively online.
    if (!registeredDriver && isRiderPhoneInUse(roomState, riderPhone, riderId)) {
      json(res, 409, { error: "RIDER_PHONE_IN_USE" });
      return;
    }

    if (!targetDriverId) {
      const best = pickBestDriver(roomState, lat, lng);
      if (!best) {
        json(res, 404, { error: "NO_DRIVERS" });
        return;
      }
      targetDriverId = best.driver.id;
      // Mark that this request was auto-matched.
      body.note = "auto";
    }

    const targetDriver = roomState.drivers.get(targetDriverId);
    if (!targetDriver?.available) return json(res, 404, { error: "DRIVER_NOT_FOUND" });
    if (!targetDriver.last) return json(res, 409, { error: "DRIVER_NO_LOCATION" });

    const activeCount = countActiveRequestsForDriver(roomState, targetDriverId);
    if (activeCount >= MAX_ACTIVE_REQUESTS_PER_DRIVER) {
      json(res, 409, {
        error: "DRIVER_AT_CAPACITY",
        capacity: MAX_ACTIVE_REQUESTS_PER_DRIVER,
      });
      return;
    }

    const distKm = haversineKm(targetDriver.last.lat, targetDriver.last.lng, lat, lng);
    if (distKm > MAX_PICKUP_DISTANCE_KM) {
      json(res, 409, {
        error: "TOO_FAR",
        maxDistanceKm: MAX_PICKUP_DISTANCE_KM,
        distanceKm: Math.round(distKm * 100) / 100,
      });
      return;
    }

    const request = {
      id: randomUUID(),
      riderId,
      name,
      riderPhone,
      note: body.note === "auto" ? "auto" : note,
      lat,
      lng,
      status: "pending",
      createdAt: nowMs(),
      targetDriverId,
      targetDriverName: targetDriver.name,
      assignedDriverId: null,
      assignedDriverName: null,
      assignedDriverPhone: null,
    };
    roomState.requests.set(request.id, request);
    dbUpsertRideRequest(room, request);

    sendRequestUpdate(roomState, request, "request:new");
    json(res, 201, { ok: true, request: publicRequest(request) });
    return;
  }

  if (url.startsWith("/api/ride/match") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });
    if (!requireRoomCodeOr401(body.code, res)) return;

    const room = sanitizeRoom(body.room);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!isValidLatLng(lat, lng)) return json(res, 400, { error: "INVALID_LAT_LNG" });

    const { state: roomState } = getRoomState(room);
    const best = pickBestDriver(roomState, lat, lng);
    if (!best) {
      json(res, 404, { error: "NO_DRIVERS" });
      return;
    }

    json(res, 200, {
      ok: true,
      driver: { id: best.driver.id, name: best.driver.name },
      etaMinutes: Math.round(best.eta * 10) / 10,
    });
    return;
  }

  if (url.startsWith("/api/ride/cancel") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });
    if (!requireRoomCodeOr401(body.code, res)) return;

    const room = sanitizeRoom(body.room);
    const riderId = (body.riderId ?? "").toString().trim().slice(0, 80);
    const requestId = (body.requestId ?? "").toString().trim();
    if (!riderId) return json(res, 400, { error: "MISSING_RIDER_ID" });

    const { state: roomState } = getRoomState(room);
    const request = requestId ? roomState.requests.get(requestId) : findActiveRequestForRider(roomState, riderId);
    if (!request || request.riderId !== riderId) {
      json(res, 404, { error: "REQUEST_NOT_FOUND" });
      return;
    }

    request.status = "cancelled";
    unindexAssigned(roomState, request);
    roomState.requests.delete(request.id);
    dbDeleteRideRequest(request.id);
    sendRequestRemove(roomState, request, "cancelled");
    json(res, 200, { ok: true });
    return;
  }

  if (url.startsWith("/api/ride/accept") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });
    if (!requireRoomCodeOr401(body.code, res)) return;
    const auth = requireDriverSession(req, res, body);
    if (!auth) return;

    const room = sanitizeRoom(body.room);
    const driverId = (body.driverId ?? "").toString().trim().slice(0, 80);
    const requestId = (body.requestId ?? "").toString().trim();
    if (!driverId) return json(res, 400, { error: "MISSING_DRIVER_ID" });
    if (!requestId) return json(res, 400, { error: "MISSING_REQUEST_ID" });
    const driverName = sanitizeName(auth.session.name);
    const driverPhone = sanitizePhone(auth.session.phone);
    if (!isValidPhone(driverPhone)) return json(res, 400, { error: "INVALID_DRIVER_PHONE" });

    const { state: roomState } = getRoomState(room);
    const driver = roomState.drivers.get(driverId);
    if (!driver) return json(res, 404, { error: "DRIVER_NOT_FOUND" });

    const request = roomState.requests.get(requestId);
    if (!request) return json(res, 404, { error: "REQUEST_NOT_FOUND" });
    if (request.status !== "pending") return json(res, 409, { error: "REQUEST_NOT_PENDING" });
    if (request.targetDriverId !== driverId) return json(res, 403, { error: "NOT_TARGET_DRIVER" });

    if (!driver.last) return json(res, 409, { error: "DRIVER_NO_LOCATION" });

    request.status = "assigned";
    request.assignedDriverId = driverId;
    request.assignedDriverName = driverName;
    request.assignedDriverPhone = driverPhone;
    indexAssigned(roomState, request);
    dbUpsertRideRequest(room, request);

    // Notify rider + assigned driver
    sendRequestUpdate(roomState, request, "request:update");
    sendDriverUpdate(roomState, driver);

    json(res, 200, { ok: true, request: publicRequest(request) });
    return;
  }

  if (url.startsWith("/api/ride/decline") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });
    if (!requireRoomCodeOr401(body.code, res)) return;
    const auth = requireDriverSession(req, res, body);
    if (!auth) return;

    const room = sanitizeRoom(body.room);
    const driverId = (body.driverId ?? "").toString().trim().slice(0, 80);
    const requestId = (body.requestId ?? "").toString().trim();
    if (!driverId) return json(res, 400, { error: "MISSING_DRIVER_ID" });
    if (!requestId) return json(res, 400, { error: "MISSING_REQUEST_ID" });

    const { state: roomState } = getRoomState(room);
    const request = roomState.requests.get(requestId);
    if (!request) return json(res, 404, { error: "REQUEST_NOT_FOUND" });
    if (request.status !== "pending") return json(res, 409, { error: "REQUEST_NOT_PENDING" });
    if (request.targetDriverId !== driverId) return json(res, 403, { error: "NOT_TARGET_DRIVER" });

    request.status = "declined";
    unindexAssigned(roomState, request);
    roomState.requests.delete(requestId);
    dbDeleteRideRequest(requestId);
    sendRequestRemove(roomState, request, "declined");
    json(res, 200, { ok: true });
    return;
  }

  if (url.startsWith("/api/ride/complete") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (body.__tooLarge) return json(res, 413, { error: "BODY_TOO_LARGE" });
    if (!requireRoomCodeOr401(body.code, res)) return;
    const auth = requireDriverSession(req, res, body);
    if (!auth) return;

    const room = sanitizeRoom(body.room);
    const driverId = (body.driverId ?? "").toString().trim().slice(0, 80);
    const requestId = (body.requestId ?? "").toString().trim();
    if (!driverId) return json(res, 400, { error: "MISSING_DRIVER_ID" });
    if (!requestId) return json(res, 400, { error: "MISSING_REQUEST_ID" });

    const { state: roomState } = getRoomState(room);
    const request = roomState.requests.get(requestId);
    if (!request) return json(res, 404, { error: "REQUEST_NOT_FOUND" });
    if (request.assignedDriverId !== driverId) {
      return json(res, 403, { error: "NOT_ASSIGNED_DRIVER" });
    }

    request.status = "completed";
    unindexAssigned(roomState, request);
    roomState.requests.delete(requestId);
    dbDeleteRideRequest(requestId);
    sendRequestRemove(roomState, request, "completed");
    json(res, 200, { ok: true });
    return;
  }

  await serveStatic(req, res);
};

const HOST = (process.env.HOST ?? "0.0.0.0").trim() || "0.0.0.0";
const USE_HTTPS = ["1", "true", "yes"].includes(
  (process.env.HTTPS ?? "").toString().trim().toLowerCase(),
);
const HTTPS_PORT = Number(process.env.HTTPS_PORT ?? 3443);
const HTTPS_CERT_FILE =
  (process.env.HTTPS_CERT_FILE ?? path.join(__dirname, "..", ".cert", "cert.pem")).trim();
const HTTPS_KEY_FILE =
  (process.env.HTTPS_KEY_FILE ?? path.join(__dirname, "..", ".cert", "key.pem")).trim();

const httpServer = http.createServer(requestHandler);
// Keep connections open longer (better for SSE + mobile networks).
httpServer.keepAliveTimeout = 70_000;
httpServer.headersTimeout = 75_000;
// SSE connections should not be terminated by requestTimeout.
httpServer.requestTimeout = 0;
httpServer.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("HTTP server error:", err);
  process.exitCode = 1;
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`Shutting down (${signal})...`);
  try {
    for (const roomState of rooms.values()) {
      for (const sub of roomState.subscribers) {
        try {
          sub.res.end();
        } catch {
          // ignore
        }
      }
      roomState.subscribers.clear();
    }
  } catch {
    // ignore
  }

  httpServer.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

httpServer.listen(PORT, HOST, async () => {
  const lanIp = pickLanIp();
  // eslint-disable-next-line no-console
  console.log(
    `HTTP: http://localhost:${PORT} (LAN ${lanIp ? `http://${lanIp}:${PORT}` : "n/a"})`,
  );

  if (!USE_HTTPS) return;

  try {
    const [key, cert] = await Promise.all([
      fs.readFile(HTTPS_KEY_FILE),
      fs.readFile(HTTPS_CERT_FILE),
    ]);

    const httpsServer = https.createServer({ key, cert }, requestHandler);
    httpsServer.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("HTTPS server error:", err);
      process.exitCode = 1;
    });

    httpsServer.listen(HTTPS_PORT, HOST, () => {
      // eslint-disable-next-line no-console
      console.log(
        `HTTPS: https://localhost:${HTTPS_PORT} (LAN ${
          lanIp ? `https://${lanIp}:${HTTPS_PORT}` : "n/a"
        })`,
      );
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `HTTPS enabled but cert/key not found.\nExpected:\n- ${HTTPS_KEY_FILE}\n- ${HTTPS_CERT_FILE}\nRun: npm run cert`,
    );
    // eslint-disable-next-line no-console
    console.error(err);
  }
});
