// Keeps Cart Caddie working with no internet on the course: everything is cached on the iPad when you install it.
const VERSION = "cc-ipad-6";
const FILES = ["./", "index.html", "app.css", "app.js", "history.js", "course.js", "caddie.wasm", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// cached copy first (works offline); when online, quietly fetch a newer version for next time
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request, { cache: "no-cache" }).then(r => { if (r.ok && new URL(e.request.url).origin === location.origin) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response("Offline", { status: 503 });
  }));
});
