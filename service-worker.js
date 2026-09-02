// Caches app shell for offline use after first load. Files/data themselves
// live in IndexedDB (see js/db.js), not the cache — this only makes the app
// itself (HTML/CSS/JS) load without a network connection.
const CACHE_NAME = "offrs-pers-files-shell-v30";
const SHELL_FILES = [
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/db.js",
  "./js/content.js",
  "./js/crypto.js",
  "./js/lock.js",
  "./js/filetype.js",
  "./js/folder.js",
  "./js/share.js",
  "./js/docs-panel.js",
  "./js/backup.js",
  "./js/onboarding.js",
  "./js/recovery.js",
  "./js/firebase-config.js",
  "./js/theme.js",
  "./js/ocr.js",
  "./js/bundle-share.js",
  "./js/timeline.js",
  "./js/date-field.js",
  "./js/track.js",
  "./assets/bg-camo.jpg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
