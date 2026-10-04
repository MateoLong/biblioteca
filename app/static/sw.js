// Keeps a copy of the app on the iPad so it opens without internet.
// Bump VERSION whenever any file below changes, so the iPad picks up the new version.
const VERSION = "biblioteca-v4";
const FILES = [
  "./", "index.html", "styles.css", "app.js", "local-api.js", "registry.js", "demo-data.js", "xlsx.js",
  "icons.svg", "favicon.svg", "manifest.webmanifest", "apple-touch-icon.png", "icon-192.png", "icon-512.png",
  "fonts/Baloo2-variable.woff2", "fonts/AtkinsonHyperlegible-400.woff2", "fonts/AtkinsonHyperlegible-700.woff2", "fonts/PatrickHand-400.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first (so updates arrive when online), cached copy when offline.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("index.html"))),
  );
});
