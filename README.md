# EWC Live App (Ride Pickup MVP)

This is a lightweight “no-login” web app for church members (mobile-first):

- **Drivers** go online to share live location.
- **Riders** instantly see a **list of available drivers** with distance.
- Riders tap a driver to send a **pickup request** to that driver.
- Drivers can **accept** and **open Google Maps** to navigate to pickup.

Most active days: **Tuesday / Thursday / Sunday**.

## Project layout

- Backend: `server/index.js`
- Frontend (static): `public/`
- Frontend assets: `public/assets/`
- SQLite DB: `server/data/ewc.sqlite`
- Deploy helpers: `deploy/`

## Run locally

```bash
npm run dev
```

Then open `http://localhost:3331`.

## Test on a phone (location)

Mobile browsers typically require a **secure context** for location. If you open the app from your phone using an IP like `http://192.168.x.x:3331`, location may be blocked.

Recommended options:

1) **Production-like**: serve from a real HTTPS domain (best).
2) **Dev**: use a tunnel with HTTPS (e.g., ngrok).
3) **Dev (LAN HTTPS)**: generate a local cert and run the built-in HTTPS listener:

```bash
npm run cert
npm run dev:lan:https
```

Then open the printed `https://<LAN_IP>:3443` URL on your phone.

### Optional: custom request sound

The “new request” alert uses `public/assets/drivernotify.mp3`.

## Optional server config

Environment variables:

- `PORT` (default `3331`)
- `ROOM_CODE` (optional) — if set, clients must provide the code to connect / post updates
- `MAX_PICKUP_MINUTES` (default `10`) — approximate “within X minutes”
- `ASSUMED_SPEED_KMH` (default `40`) — used to convert distance → minutes
- `MAX_PICKUP_DISTANCE_KM` (optional) — overrides the derived distance from minutes/speed
- `MAX_ACTIVE_REQUESTS_PER_DRIVER` (default `3`)
- `REQUEST_TTL_MINUTES` (default `5`) — pending request expires if not accepted
- `DRIVER_STALE_SECONDS` (default `45`)
- `RIDER_SNAPSHOT_SECONDS` (default `10`) — riders receive a full driver snapshot every N seconds
- `DRIVER_BROADCAST_MIN_MS` (default `5000`) — server throttles driver location broadcasts
- `DRIVER_BROADCAST_MIN_MOVE_M` (default `30`) — server broadcasts when driver moved by N meters
- `ASSIGNED_TTL_MINUTES` (default `180`) — assigned rides are auto-cleaned after N minutes
- `HTTPS=1` (optional) — enable HTTPS listener (requires `.cert/key.pem` + `.cert/cert.pem`)
- `HTTPS_PORT` (default `3443`)

### Optional URL params

To avoid extra inputs, you can pass:

- `?room=ewc` (default: `ewc`)
- `?code=...` (only if `ROOM_CODE` is enabled)

## VPS deploy notes (recommended)

- Put the Node server behind **Nginx** (helps with TLS, keep-alives, gzip, etc.).
- For SSE, disable proxy buffering.
- Increase open file limits (`ulimit -n`) so hundreds of connections don’t hit `EMFILE`.
- Use HTTPS in production (browsers require a secure context for geolocation).

Minimal Nginx snippet (inside your `server { ... }`):

```nginx
location /api/stream {
  proxy_pass http://127.0.0.1:3331;
  proxy_http_version 1.1;
  proxy_set_header Connection "";
  proxy_buffering off;
  proxy_read_timeout 1h;
}

location / {
  proxy_pass http://127.0.0.1:3331;
}
```

Systemd tip: set a higher file limit, e.g. `LimitNOFILE=65535`.

### Production-ish quickstart (Ubuntu/Debian)

1) Copy env:

```bash
cp .env.example .env
```

2) Start the app locally on the VPS (bind to loopback; let Nginx handle public traffic):

```bash
npm run start:prod
```

3) Nginx + systemd examples:

- `deploy/nginx-ewc-live.conf`
- `deploy/ewc-live.service`
