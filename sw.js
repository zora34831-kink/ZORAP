
const CACHE_NAME = "zorap-cache-v1";

const STATIC_FILES = [
  "/",
  "/index.html",
  "/app.html",
  "/admin.html",
  "/manifest.json",
  "/css/style.css",
  "/css/chat.css",
  "/css/admin.css"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(STATIC_FILES)
    )
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Jangan cache Firebase atau API
  if (
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("firebaseio.com") ||
    url.pathname.startsWith("/api/")
  ) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (
          response.ok &&
          url.origin === self.location.origin
        ) {
          const copy = response.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, copy);
          });
        }

        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
