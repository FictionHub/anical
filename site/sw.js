/* Tsuzuki service worker — makes the app installable & openable offline.
   Strategy:
     • navigations  -> network-first, fall back to the cached app shell
     • *.json data  -> network-first, fall back to last cached copy
     • other same-origin static -> cache-first (then network + cache)
     • cross-origin (AniList, ANN, Open-Meteo, images) -> untouched (network)
   Live anime data is always fetched fresh; the cache only guarantees the app
   still opens with offline/sample data when there's no connection. */
const CACHE = "tsuzuki-v1";
const SHELL = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest", "/og-image.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // let cross-origin (API/images) hit the network directly

  // App pages: prefer fresh, fall back to the cached shell so the app opens offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {}); return r; })
        .catch(() => caches.match(req).then(m => m || caches.match("/index.html")))
    );
    return;
  }

  // JSON data (events.json, etc.): network-first so it stays current, cache as backup.
  if (url.pathname.endsWith(".json")) {
    e.respondWith(
      fetch(req)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)).catch(() => {}); return r; })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else same-origin (favicon, manifest, og image): cache-first.
  e.respondWith(
    caches.match(req).then(c => c || fetch(req).then(r => {
      const cp = r.clone(); caches.open(CACHE).then(ca => ca.put(req, cp)).catch(() => {}); return r;
    }))
  );
});

// Clicking an episode alert focuses an open Tsuzuki tab (or opens one) on that show.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { try { await c.focus(); if (url && "navigate" in c) await c.navigate(url); return; } catch (_) {} }
    }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});

// Server-driven Web Push (used only if a push backend is added later; harmless otherwise).
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "Tsuzuki", {
    body: d.body || "", icon: d.icon, tag: d.tag, data: { url: d.url || "/" },
  }));
});
