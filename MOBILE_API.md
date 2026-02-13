# EWC Rides — Mobile API (Flutter) Guide

This document describes the backend API you can use from the Flutter mobile app.

## Base URL

Use your backend base URL, for example:

- `https://ewc-rides.onrender.com`

All endpoints below are relative to the base URL.

## Common concepts

### `room`

- Most requests include a `room` (string). If omitted on the web app, it defaults to `ewc`.
- Recommended: always send `room: "ewc"` unless you intentionally support multiple rooms.

### `code` (optional room code)

- If the server is configured with `ROOM_CODE`, then **every API call** and the SSE stream must include `code`.
- If `ROOM_CODE` is not enabled on the server, you can omit it.

### `deviceId`

- The server expects a device identifier in SSE query params (`id=...`) and in several POST bodies (`driverId`, `riderId`).
- On Flutter, generate a UUID on first launch and persist it (SharedPreferences / secure storage).

### Auth (drivers)

- Drivers authenticate using a 4‑digit code (derived from last 4 digits of phone at registration time).
- Driver login returns a `token` (bearer token). Send it as:
  - `Authorization: Bearer <token>`

## Responses and errors

- Errors are returned as JSON: `{ "error": "SOME_CODE" }`
- HTTP status varies by error (400/401/403/404/409/413/500).

## Endpoints

### Health

**GET** `/api/health`

Use this to check if the backend is reachable.

Response:
```json
{ "ok": true, "now": 1730000000000 }
```

### Config

**GET** `/api/config`

Response includes tuning values the UI can use:
```json
{
  "roomCodeRequired": false,
  "maxPickupDistanceKm": 6.66,
  "maxPickupMinutes": 10,
  "assumedSpeedKmh": 40,
  "maxActiveRequestsPerDriver": 3,
  "requestTtlMinutes": 5,
  "driverStaleSeconds": 45,
  "daysOpen": ["Tuesday","Thursday","Sunday"]
}
```

## Live stream (SSE)

### Connect

**GET** `/api/stream?room=<room>&role=<driver|rider>&id=<deviceId>[&code=<roomCode>][&token=<driverToken>]`

Notes:
- `role=rider` does **not** require a token.
- `role=driver` **requires** `token=<driverToken>` or you will get `401`.

### Events

You will receive events like:

- `snapshot` (initial + periodic for riders)
- `driver:update`
- `driver:remove`
- `request:new`
- `request:update`
- `request:remove`
- `ping`

Each event’s payload is JSON in the `data:` line.

## Recommended real-time strategy (Flutter)

Use **SSE as the primary real-time channel**, with a small polling fallback.

### Why SSE (recommended)

- Lower overhead than frequent polling.
- Matches the backend’s existing design (`/api/stream` already powers the web app).
- Great fit for “push” events: new requests, accept/decline, assigned-driver location updates.

### Mobile constraints to plan for

- Phones can pause/throttle networking when the app is backgrounded.
- Some networks drop long-lived connections.
- You should implement reconnect + fallback.

### Suggested app behavior

- Foreground (Home/Driver/Rider screens): keep an SSE connection open.
- Backgrounded: disconnect SSE (or expect it to be killed) and resume on foreground.
- If SSE disconnects unexpectedly: retry with backoff; if it keeps failing, use polling for a short period.

### Reconnect policy (simple + solid)

- Retry delays: `1s → 2s → 5s → 10s → 20s` (cap at 20s)
- Reset backoff after you receive a valid `snapshot`.

### Polling fallback (minimal)

If SSE is down, you can poll these endpoints:
- `GET /api/config` every ~60s (optional)
- Reconnect SSE in the background

Note: the backend does **not** currently expose “poll equivalents” for everything (drivers list + rider request state) as dedicated REST endpoints; SSE `snapshot` is the main source of truth. If you want true polling mode, add endpoints like:
- `GET /api/drivers?room=...`
- `GET /api/rider/active?room=...&riderId=...`
- `GET /api/driver/requests?room=...&driverId=...` (auth)

### Dart SSE approach (recommended)

Use `package:http` and parse the streamed response as text lines:

- Open a `http.Request("GET", streamUri)` and `client.send(request)`.
- Decode bytes with `utf8.decoder`, split by lines.
- Parse blocks separated by blank lines:
  - `event: <name>`
  - `data: <json>`
- Dispatch by event name (`snapshot`, `request:new`, etc.).

Implementation note:
- iOS/Android can buffer; keep `proxy_buffering off` in Nginx for `/api/stream`.

## Driver auth

### Register driver

**POST** `/api/auth/driver/register`

Body:
```json
{ "name": "John", "phone": "233555123456" }
```

Response:
```json
{ "ok": true, "driver": { "name": "John", "phoneLast4": "3456" }, "code": "3456" }
```

Common errors:
- `PHONE_IN_USE` (409)
- `CODE_IN_USE` (409)
- `INVALID_PHONE` (400)

### Login driver

**POST** `/api/auth/driver/login`

Body:
```json
{ "code": "3456" }
```

Response:
```json
{
  "ok": true,
  "token": "<bearer-token>",
  "driver": { "name": "John", "phone": "233555123456", "phoneLast4": "3456" }
}
```

Common errors:
- `DRIVER_NOT_REGISTERED` (404)
- `INVALID_CODE` (400)

### Get current driver (token validation)

**GET** `/api/auth/driver/me`

Header:
- `Authorization: Bearer <token>`

Response:
```json
{ "ok": true, "driver": { "name": "John", "phone": "233555123456", "phoneLast4": "3456" } }
```

Common errors:
- `DRIVER_AUTH_REQUIRED` / `DRIVER_AUTH_INVALID` / `DRIVER_AUTH_EXPIRED` (401)

## Driver presence + location (requires bearer token)

### Start (go online)

**POST** `/api/driver/start`

Headers:
- `Authorization: Bearer <token>`

Body:
```json
{ "room": "ewc", "driverId": "<deviceId>", "code": "<optionalRoomCode>" }
```

### Update location

**POST** `/api/driver/update`

Headers:
- `Authorization: Bearer <token>`

Body:
```json
{
  "room": "ewc",
  "driverId": "<deviceId>",
  "lat": 5.6037,
  "lng": -0.1870,
  "accuracyM": 12.3,
  "heading": 90,
  "speedMps": 2.1,
  "code": "<optionalRoomCode>"
}
```

### Stop (go offline)

**POST** `/api/driver/stop`

Headers:
- `Authorization: Bearer <token>`

Body:
```json
{ "room": "ewc", "driverId": "<deviceId>", "code": "<optionalRoomCode>" }
```

## Rider flow

### Match nearest driver

**POST** `/api/ride/match`

Body:
```json
{ "room": "ewc", "lat": 5.6037, "lng": -0.1870, "code": "<optionalRoomCode>" }
```

Response:
```json
{ "ok": true, "driver": { "id": "<driverId>", "name": "John" }, "etaMinutes": 4.3 }
```

Common errors:
- `NO_DRIVERS` (404)
- `INVALID_LAT_LNG` (400)

### Create ride request

**POST** `/api/ride/request`

Body:
```json
{
  "room": "ewc",
  "riderId": "<deviceId>",
  "name": "Isaac",
  "phone": "233555000111",
  "lat": 5.6037,
  "lng": -0.1870,
  "targetDriverId": "<optionalDriverId>",
  "note": "",
  "code": "<optionalRoomCode>"
}
```

Common errors:
- `NO_DRIVERS` (404) (if auto-match is used)
- `DRIVER_NOT_FOUND` (404)
- `DRIVER_AT_CAPACITY` (409)
- `TOO_FAR` (409)
- `RIDER_PHONE_RESERVED` (409)
- `RIDER_PHONE_IN_USE` (409)

### Cancel ride request

**POST** `/api/ride/cancel`

Body:
```json
{
  "room": "ewc",
  "riderId": "<deviceId>",
  "requestId": "<optional>",
  "code": "<optionalRoomCode>"
}
```

## Driver handling of ride requests (requires bearer token)

### Accept request

**POST** `/api/ride/accept`

Headers:
- `Authorization: Bearer <token>`

Body:
```json
{ "room": "ewc", "driverId": "<deviceId>", "requestId": "<requestId>", "code": "<optionalRoomCode>" }
```

Response includes the updated request and will include the driver’s contact for the rider.

### Decline request

**POST** `/api/ride/decline`

Headers:
- `Authorization: Bearer <token>`

Body:
```json
{ "room": "ewc", "driverId": "<deviceId>", "requestId": "<requestId>", "code": "<optionalRoomCode>" }
```
