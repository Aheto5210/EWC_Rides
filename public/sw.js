const CACHE_NAME = "ewc-rides-v82";
const ASSETS = [
  "/",
  "/index.html",
  "/assets/css/styles.css",
  "/assets/js/main.js",
  "/assets/drivernotify.mp3",
  "/assets/js/app/app.js",
  "/assets/js/app/api.js",
  "/assets/js/app/auth.js",
  "/assets/js/app/activity.js",
  "/assets/js/app/audio.js",
  "/assets/js/app/call.js",
  "/assets/js/app/constants.js",
  "/assets/js/app/dom.js",
  "/assets/js/app/geo.js",
  "/assets/js/app/notifications.js",
  "/assets/js/app/sheet.js",
  "/assets/js/app/state.js",
  "/assets/js/app/storage.js",
  "/assets/js/app/theme.js",
  "/assets/js/app/utils.js",
  "/assets/manifest.webmanifest",
  "/assets/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(event.request);

      const fetchPromise = fetch(event.request)
        .then((res) => {
          if (res && res.ok) cache.put(event.request, res.clone());
          return res;
        })
        .catch(() => null);

      // Stale-while-revalidate for our app shell.
      if (cached) {
        fetchPromise.catch(() => {});
        return cached;
      }

      const network = await fetchPromise;
      if (network) return network;

      // Offline fallback for navigation.
      if (event.request.mode === "navigate") {
        const shell = await cache.match("/index.html");
        if (shell) return shell;
      }
      return new Response("Offline", { status: 503 });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification?.close();
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        try {
          await client.focus();
          return;
        } catch {
          // ignore
        }
      }
      await self.clients.openWindow("/");
    })(),
  );
});
