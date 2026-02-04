import http from "node:http";
import https from "node:https";
import { randomUUID, randomBytes } from "node:crypto";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = path.join(__dirname, "..", "public");

const ROOM_CODE = (process.env.ROOM_CODE ?? "").trim() || null;
const DRIVER_DB_FILE = path.join(__dirname, "data", "drivers.json");
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
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(req) {
  const raw = await readBody(req);
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

async function readDriverDb() {
  try {
    const raw = await fs.readFile(DRIVER_DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { drivers: {} };
    if (!parsed.drivers || typeof parsed.drivers !== "object") return { drivers: {} };
    return { drivers: parsed.drivers };
  } catch {
    return { drivers: {} };
  }
}

async function writeDriverDb(db) {
  await ensureDir(path.dirname(DRIVER_DB_FILE));
  const tmp = `${DRIVER_DB_FILE}.${randomUUID()}.tmp`;
  const payload = JSON.stringify(db, null, 2);
  await fs.writeFile(tmp, payload, "utf8");
  await fs.rename(tmp, DRIVER_DB_FILE);
}

const driverDb = await readDriverDb();
const driverSessions = new Map(); // token -> { phone, name, createdAt, expiresAt }
const loginChallenges = new Map(); // id -> { phones: string[], expiresAt: number }

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
    drivers: new Map(), // driverId -> driver
    requests: new Map(), // requestId -> request
    subscribers: new Set(), // sse clients
  };
}

const rooms = new Map(); // roomId -> roomState

function getRoomState(roomId) {
  const id = sanitizeRoom(roomId);
  let state = rooms.get(id);
  if (!state) {
    state = makeRoomState();
    rooms.set(id, state);
  }
  return { id, state };
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseKeepAlive(res) {
  res.write(`event: ping\n`);
  res.write(`data: ${nowMs()}\n\n`);
}

function sendSnapshot(subscriber, roomId, roomState) {
  const drivers = [];
  for (const driver of roomState.drivers.values()) {
    if (!driver.available) continue;
    if (!driver.last) continue;
    drivers.push(publicDriver(driver));
  }

  const payload = {
    room: roomId,
    now: nowMs(),
    config: {
      maxPickupDistanceKm: MAX_PICKUP_DISTANCE_KM,
      maxPickupMinutes: MAX_PICKUP_MINUTES_EFFECTIVE,
      assumedSpeedKmh: ASSUMED_SPEED_KMH,
      maxActiveRequestsPerDriver: MAX_ACTIVE_REQUESTS_PER_DRIVER,
      requestTtlMinutes: Math.round(REQUEST_TTL_MS / 60_000),
      driverStaleSeconds: Math.round(DRIVER_STALE_MS / 1_000),
      roomCodeRequired: Boolean(ROOM_CODE),
    },
    drivers,
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
    if (sub.role !== "driver" && sub.role !== "rider") return;
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

  for (const roomState of rooms.values()) {
    for (const [driverId, driver] of roomState.drivers.entries()) {
      if (!driver.available) continue;
      const updatedAt = driver.last?.updatedAt ?? 0;
      if (updatedAt >= cutoffDriver) continue;
      driver.available = false;
      roomState.drivers.delete(driverId);
      sendDriverRemove(roomState, driverId);
    }

    for (const [requestId, req] of roomState.requests.entries()) {
      if (req.status !== "pending") continue;
      if (req.createdAt >= cutoffRequest) continue;
      roomState.requests.delete(requestId);
      sendRequestRemove(roomState, req, "expired");
    }
  }
}

setInterval(cleanupStale, 5_000).unref();

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
    const data = await fs.readFile(filePath);
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

    res.writeHead(200, {
      "content-type": contentType ?? "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=60",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const requestHandler = async (req, res) => {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

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

    req.on("close", () => {
      clearInterval(keepAlive);
      roomState.subscribers.delete(subscriber);
    });
    return;
  }

  if (url.startsWith("/api/auth/driver/register") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });

    const name = sanitizeName(body.name);
    const phone = sanitizePhone(body.phone);
    if (!name) return json(res, 400, { error: "MISSING_NAME" });
    if (!isValidPhone(phone)) return json(res, 400, { error: "INVALID_PHONE" });

    const now = nowMs();
    const existing = driverDb.drivers[phone];
    driverDb.drivers[phone] = {
      phone,
      name,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await writeDriverDb(driverDb);

    setCookie(res, "ewc_driver_phone", phone, {
      maxAgeSeconds: Math.floor(DRIVER_SESSION_TTL_MS / 1_000),
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    });

    json(res, 201, {
      ok: true,
      driver: { name, phoneLast4: last4(phone) },
      code: last4(phone),
    });
    return;
  }

  if (url.startsWith("/api/auth/driver/login") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });

    const cookies = parseCookies(req);
    const phoneFromBody = sanitizePhone(body.phone);
    const cookiePhone = sanitizePhone(cookies.ewc_driver_phone);
    let phone = sanitizePhone(phoneFromBody || cookiePhone);
    const code = digitsOnly(body.code).slice(0, 4);
    if (!code || code.length !== 4) return json(res, 400, { error: "INVALID_CODE" });

    if (!isValidPhone(phone)) {
      const matches = [];
      for (const [p] of Object.entries(driverDb.drivers)) {
        if (last4(p) !== code) continue;
        matches.push(p);
      }

      if (matches.length === 0) return json(res, 404, { error: "DRIVER_NOT_REGISTERED" });

      if (matches.length === 1) {
        phone = sanitizePhone(matches[0]);
      } else {
        const challengeId = makeToken();
        loginChallenges.set(challengeId, {
          phones: matches.map((p) => sanitizePhone(p)),
          expiresAt: nowMs() + 5 * 60_000,
        });
        json(res, 409, {
          error: "CODE_AMBIGUOUS",
          challengeId,
          choices: matches.map((p) => ({
            name: driverDb.drivers[p]?.name ?? "Driver",
          })),
        });
        return;
      }
    }

    const record = driverDb.drivers[phone];
    if (!record) return json(res, 404, { error: "DRIVER_NOT_REGISTERED" });
    const expected = last4(phone);
    if (code !== expected) return json(res, 401, { error: "INVALID_CODE" });

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
      driver: { name: record.name, phone, phoneLast4: expected },
    });
    return;
  }

  if (url.startsWith("/api/auth/driver/login/resolve") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });

    const challengeId = (body.challengeId ?? "").toString().trim();
    const idx = Number(body.choiceIndex);
    if (!challengeId) return json(res, 400, { error: "MISSING_CHALLENGE" });
    if (!Number.isInteger(idx) || idx < 0) return json(res, 400, { error: "INVALID_CHOICE" });

    const challenge = loginChallenges.get(challengeId);
    if (!challenge) return json(res, 404, { error: "CHALLENGE_NOT_FOUND" });
    if (challenge.expiresAt < nowMs()) {
      loginChallenges.delete(challengeId);
      return json(res, 410, { error: "CHALLENGE_EXPIRED" });
    }

    const phone = challenge.phones[idx];
    if (!phone) return json(res, 400, { error: "INVALID_CHOICE" });

    const record = driverDb.drivers[phone];
    if (!record) return json(res, 404, { error: "DRIVER_NOT_REGISTERED" });

    const token = makeToken();
    const now = nowMs();
    driverSessions.set(token, {
      phone,
      name: record.name,
      createdAt: now,
      expiresAt: now + DRIVER_SESSION_TTL_MS,
    });
    loginChallenges.delete(challengeId);

    setCookie(res, "ewc_driver_phone", phone, {
      maxAgeSeconds: Math.floor(DRIVER_SESSION_TTL_MS / 1_000),
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
    });

    json(res, 200, {
      ok: true,
      token,
      driver: { name: record.name, phone, phoneLast4: last4(phone) },
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
    if (!requireRoomCodeOr401(body.code, res)) return;
    const auth = requireDriverSession(req, res, body);
    if (!auth) return;

    const room = sanitizeRoom(body.room);
    const driverId = (body.driverId ?? "").toString().trim().slice(0, 80);
    if (!driverId) return json(res, 400, { error: "MISSING_DRIVER_ID" });
    const name = sanitizeName(auth.session.name);

    const { state: roomState } = getRoomState(room);
    const existing = roomState.drivers.get(driverId);
    const driver = existing ?? {
      id: driverId,
      name,
      available: true,
      last: null,
    };
    driver.name = name;
    driver.available = true;
    roomState.drivers.set(driverId, driver);

    sendDriverUpdate(roomState, driver);
    json(res, 200, { ok: true });
    return;
  }

  if (url.startsWith("/api/driver/update") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
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
      available: true,
      last: null,
    };

    driver.available = true;
    driver.name = sanitizeName(auth.session.name ?? driver.name);
    driver.last = {
      lat,
      lng,
      accuracyM,
      heading,
      speedMps,
      updatedAt: nowMs(),
    };
    roomState.drivers.set(driverId, driver);

    sendDriverUpdate(roomState, driver);
    json(res, 200, { ok: true });
    return;
  }

  if (url.startsWith("/api/driver/stop") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
    if (!requireRoomCodeOr401(body.code, res)) return;
    const auth = requireDriverSession(req, res, body);
    if (!auth) return;

    const room = sanitizeRoom(body.room);
    const driverId = (body.driverId ?? "").toString().trim().slice(0, 80);
    if (!driverId) return json(res, 400, { error: "MISSING_DRIVER_ID" });

    const { state: roomState } = getRoomState(room);
    roomState.drivers.delete(driverId);
    sendDriverRemove(roomState, driverId);
    json(res, 200, { ok: true });
    return;
  }

  if (url.startsWith("/api/ride/request") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
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
    const targetDriverId = (body.targetDriverId ?? "").toString().trim().slice(0, 80);
    const note = (body.note ?? "").toString().trim().slice(0, 120);
    if (!isValidPhone(riderPhone)) return json(res, 400, { error: "INVALID_RIDER_PHONE" });
    if (!targetDriverId) return json(res, 400, { error: "MISSING_TARGET_DRIVER_ID" });
    if (!isValidLatLng(lat, lng)) return json(res, 400, { error: "INVALID_LAT_LNG" });

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
      note,
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

    sendRequestUpdate(roomState, request, "request:new");
    json(res, 201, { ok: true, request: publicRequest(request) });
    return;
  }

  if (url.startsWith("/api/ride/cancel") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
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
    roomState.requests.delete(request.id);
    sendRequestRemove(roomState, request, "cancelled");
    json(res, 200, { ok: true });
    return;
  }

  if (url.startsWith("/api/ride/accept") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
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

    // Notify rider + assigned driver
    sendRequestUpdate(roomState, request, "request:update");
    sendDriverUpdate(roomState, driver);

    json(res, 200, { ok: true, request: publicRequest(request) });
    return;
  }

  if (url.startsWith("/api/ride/decline") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
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
    roomState.requests.delete(requestId);
    sendRequestRemove(roomState, request, "declined");
    json(res, 200, { ok: true });
    return;
  }

  if (url.startsWith("/api/ride/complete") && method === "POST") {
    const body = await readJson(req);
    if (!body) return json(res, 400, { error: "INVALID_JSON" });
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
    roomState.requests.delete(requestId);
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
httpServer.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("HTTP server error:", err);
  process.exitCode = 1;
});

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
