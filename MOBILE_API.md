# EWC Rides Mobile API

Use this document for Flutter integration with the current backend.

## Base URL

- Production: `https://ewc-rides.onrender.com`
- Local: `http://localhost:3331`

All endpoints below are relative to your selected base URL.

## Core rules

- Most requests include `room` (use `"ewc"` by default).
- If server uses `ROOM_CODE`, include `code` in API bodies and SSE query.
- Persist one UUID per device for `driverId` / `riderId`.
- Auth uses bearer tokens: `Authorization: Bearer <token>`.

---

## Auth

### Register

`POST /api/auth/register`

```json
{
  "name": "John",
  "phone": "233555123456",
  "email": "john@email.com",
  "password": "secret123",
  "role": "driver"
}
```

`role` must be `driver` or `rider`.

### Login

`POST /api/auth/login`

```json
{
  "email": "john@email.com",
  "password": "secret123"
}
```

Optional: send `role` to enforce expected role.

### Get current user

`GET /api/auth/me` (bearer required)

---

## Config + health

### Health

`GET /api/health`

### Config

`GET /api/config`

Includes:
- `maxPickupMinutes` (default ~20)
- `assumedSpeedKmh`
- `maxActiveRequestsPerDriver`
- `requestTtlMinutes`
- `driverStaleSeconds`
- `daysOpen`

---

## Real-time stream (SSE)

`GET /api/stream?room=<room>&role=<driver|rider>&id=<deviceId>[&code=<roomCode>][&token=<driverToken>]`

Notes:
- Driver stream requires valid driver token.
- Rider stream does not require token.
- Events: `snapshot`, `driver:update`, `driver:remove`, `request:new`, `request:update`, `request:remove`, `ping`.

Recommended for Flutter:
- Use SSE while app is foregrounded.
- Reconnect with backoff (`1s, 2s, 5s, 10s, 20s`).

---

## Driver APIs (driver token required)

### Go online

`POST /api/driver/start`

```json
{
  "room": "ewc",
  "driverId": "<deviceId>",
  "destination": "Accra Mall",
  "code": "<optionalRoomCode>"
}
```

`destination` is required.

### Send location update

`POST /api/driver/update`

```json
{
  "room": "ewc",
  "driverId": "<deviceId>",
  "lat": 5.6037,
  "lng": -0.1870,
  "accuracyM": 12.3,
  "heading": 90,
  "speedMps": 2.1,
  "destination": "Accra Mall",
  "code": "<optionalRoomCode>"
}
```

`destination` is optional here (used when route changes).

### Update destination only

`POST /api/driver/destination`

```json
{
  "room": "ewc",
  "driverId": "<deviceId>",
  "destination": "Accra Mall",
  "code": "<optionalRoomCode>"
}
```

### Go offline

`POST /api/driver/stop`

```json
{
  "room": "ewc",
  "driverId": "<deviceId>",
  "code": "<optionalRoomCode>"
}
```

---

## Ride APIs

### Match nearest compatible driver

`POST /api/ride/match`

```json
{
  "room": "ewc",
  "lat": 5.6037,
  "lng": -0.1870,
  "destination": "Accra Mall",
  "code": "<optionalRoomCode>"
}
```

Returns nearest driver with compatible destination and ETA within server threshold (~20 min by default).

### Create ride request

`POST /api/ride/request`

```json
{
  "room": "ewc",
  "riderId": "<deviceId>",
  "name": "Isaac",
  "phone": "233555000111",
  "destination": "Accra Mall",
  "lat": 5.6037,
  "lng": -0.1870,
  "targetDriverId": "<optionalDriverId>",
  "note": "",
  "code": "<optionalRoomCode>"
}
```

Rules:
- `destination` is required.
- If `targetDriverId` is omitted, server auto-picks closest compatible driver.
- Driver capacity and distance/ETA limits are enforced.

### Cancel request

`POST /api/ride/cancel`

```json
{
  "room": "ewc",
  "riderId": "<deviceId>",
  "requestId": "<optional>",
  "code": "<optionalRoomCode>"
}
```

### Driver accepts request (driver token required)

`POST /api/ride/accept`

```json
{
  "room": "ewc",
  "driverId": "<deviceId>",
  "requestId": "<requestId>",
  "code": "<optionalRoomCode>"
}
```

### Driver declines request (driver token required)

`POST /api/ride/decline`

```json
{
  "room": "ewc",
  "driverId": "<deviceId>",
  "requestId": "<requestId>",
  "code": "<optionalRoomCode>"
}
```

### Driver completes request (driver token required)

`POST /api/ride/complete`

```json
{
  "room": "ewc",
  "driverId": "<deviceId>",
  "requestId": "<requestId>",
  "code": "<optionalRoomCode>"
}
```

### Ride history (token required)

`GET /api/ride/history?limit=40`

Returns role-aware history:
- driver sees rows where their phone is `driver_phone`
- rider sees rows where their phone is `rider_phone`

---

## Common error codes

- `AUTH_REQUIRED`, `AUTH_INVALID`, `AUTH_EXPIRED`
- `AUTH_ROLE_MISMATCH`
- `INVALID_JSON`, `BODY_TOO_LARGE`
- `MISSING_DRIVER_DESTINATION`
- `MISSING_RIDER_DESTINATION`
- `INVALID_LAT_LNG`
- `NO_DRIVERS`
- `DRIVER_NOT_FOUND`
- `DRIVER_AT_CAPACITY`
- `DRIVER_NO_LOCATION`
- `TOO_FAR`
- `DESTINATION_MISMATCH`
- `RIDER_PHONE_RESERVED`
- `RIDER_PHONE_IN_USE`

---

## Flutter integration checklist

- Persist `deviceId`, token, and user profile locally.
- Open SSE after login and role selection in app state.
- For driver mode:
  - call `/api/driver/start` once
  - post `/api/driver/update` every 5–10 seconds while online
- For rider mode:
  - set destination before calling `/api/ride/match` or `/api/ride/request`
- Always reconnect SSE with backoff on disconnect.
