/* Le Sac à PDF — service worker : fonctionnement hors ligne + réception des
   PDF partagés depuis d'autres applications (Android). */
const VERSION = "sac-a-pdf-v1.2.0";
const FILES = [
  "./", "index.html", "css/app.css", "js/app.js", "manifest.webmanifest",
  "vendor/pdf.min.js", "vendor/pdf.worker.min.js", "vendor/pdf-lib.min.js",
  "icons/icon-192.png", "icons/icon-512.png",
  "icons/maskable-192.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "sac-shared").map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  /* PDF reçu via « Partager » (Web Share Target) */
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      try {
        const form = await e.request.formData();
        const file = form.get("file");
        if (file) {
          const c = await caches.open("sac-shared");
          await c.put("shared-file", new Response(file, { headers: {
            "Content-Type": "application/pdf", "X-Name": encodeURIComponent(file.name || "document.pdf") } }));
        }
      } catch (err) {}
      return Response.redirect("./?shared=1", 303);
    })());
    return;
  }
  if (e.request.method !== "GET") return;

  /* cache d'abord (application 100 % locale), mise à jour en arrière-plan */
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    const hit = await c.match(e.request, { ignoreSearch: url.pathname.endsWith("/") || url.pathname.endsWith("index.html") });
    const net = fetch(e.request).then(r => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    const r = await net;
    return r || (e.request.mode === "navigate" ? c.match("index.html") : Response.error());
  })());
});
