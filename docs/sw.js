const CACHE_NAME = "fanzzy-shell-v3";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/app-icon-192.png",
  "/app-icon-512.png"
];

const readCachedResponse = async (request) => {
  try { return await caches.match(request); }
  catch { return undefined; }
};

const trimCache = async (cache, count) => {
  const keys = await cache.keys();
  const removable = keys.filter((key) => !APP_SHELL.includes(new URL(key.url).pathname));
  // Prefer evicting display images to the scripts needed by offline pages.
  removable.sort((a, b) => Number(/\.(?:webp|png|jpe?g|gif)$/i.test(new URL(b.url).pathname)) - Number(/\.(?:webp|png|jpe?g|gif)$/i.test(new URL(a.url).pathname)));
  await Promise.all(removable.slice(0, count ?? Math.max(0, keys.length - 160)).map((key) => cache.delete(key)));
};

const cacheResponse = async (request, response) => {
  try {
    const cache = await caches.open(CACHE_NAME);
    // Keep a second copy because Cache.put can consume the first body's stream
    // even when it rejects. A quota retry must receive an unused response.
    const retry = response.clone();
    try { await cache.put(request, response); }
    catch (error) {
      if (error?.name !== "QuotaExceededError") throw error;
      await trimCache(cache, 20);
      await cache.put(request, retry);
    }
    await trimCache(cache);
  } catch {
    // Offline caching must never discard a successful network response.
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).catch(() => undefined)
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/admin")) return;

  // Only content-addressed display copies are immutable. Catalog, stock and
  // HTML remain network-first so returning customers see current data.
  if (/^\/optimized\/[a-f0-9]{20}\.webp$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cached = await readCachedResponse(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cacheResponse(request, response.clone());
      return response;
    })());
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(cacheResponse(request, copy));
          }
          return response;
        })
        .catch(() => readCachedResponse(request).then((cached) => cached || Response.error()))
    );
    return;
  }

  if (["style", "script", "image", "font"].includes(request.destination)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(cacheResponse(request, copy));
          }
          return response;
        })
        .catch(() => readCachedResponse(request).then((cached) => cached || Response.error()))
    );
  }
});
