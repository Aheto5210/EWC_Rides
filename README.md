# EWC Live App (Ride Pickup MVP)

This is a lightweight “no-login” web app for church members (mobile-first):

- **Drivers** go online to share live location.
- **Riders** instantly see a **list of available drivers** with distance.
- Riders tap a driver to send a **pickup request** to that driver.
- Drivers can **accept** and **open Google Maps** to navigate to pickup.

Most active days: **Tuesday / Thursday / Sunday**.

## Run locally

```bash
npm run dev
```

Then open `http://localhost:3000`.

## Test on a phone (location)

Mobile browsers typically require a **secure context** for location. If you open the app from your phone using an IP like `http://192.168.x.x:3000`, location may be blocked.

Recommended options:

1) **Production-like**: serve from a real HTTPS domain (best).
2) **Dev**: use a tunnel with HTTPS (e.g., ngrok).
3) **Dev (LAN HTTPS)**: generate a local cert and run the built-in HTTPS listener:

```bash
npm run cert
npm run dev:lan:https
```

Then open the printed `https://<LAN_IP>:3443` URL on your phone.

## Optional server config

Environment variables:

- `PORT` (default `3000`)
- `ROOM_CODE` (optional) — if set, clients must provide the code to connect / post updates
- `MAX_PICKUP_MINUTES` (default `10`) — approximate “within X minutes”
- `ASSUMED_SPEED_KMH` (default `40`) — used to convert distance → minutes
- `MAX_PICKUP_DISTANCE_KM` (optional) — overrides the derived distance from minutes/speed
- `MAX_ACTIVE_REQUESTS_PER_DRIVER` (default `3`)
- `REQUEST_TTL_MINUTES` (default `5`) — pending request expires if not accepted
- `DRIVER_STALE_SECONDS` (default `45`)
 - `HTTPS=1` (optional) — enable HTTPS listener (requires `.cert/key.pem` + `.cert/cert.pem`)
 - `HTTPS_PORT` (default `3443`)

### Optional URL params

To avoid extra inputs, you can pass:

- `?room=ewc` (default: `ewc`)
- `?code=...` (only if `ROOM_CODE` is enabled)
