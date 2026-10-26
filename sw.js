/* Hubzone e-Dziennik — service worker: always network first (newest version), cached copy only when offline. */
const CACHE = "hz-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;   // Firebase etc. go straight to the network
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && res.type === "basic") { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") { const home = await caches.match("./", { ignoreSearch: true }) || await caches.match("index.html", { ignoreSearch: true }); if (home) return home; }
      throw err;
    }
  })());
});
