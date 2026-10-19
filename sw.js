/* Relative paths so the site works at /mood-practice/ on GitHub Pages. */
const CACHE = "mood-practice-v1";
const ASSETS = [
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./worksheets.json",
  "./emotion-worksheets.pdf",
  "./js/app.js",
  "./js/form.js",
  "./js/store.js",
  "./js/util.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith("/sw.js")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached =
        (await cache.match(request)) ||
        (request.mode === "navigate" ? await cache.match("./index.html") : null);
      if (cached) {
        fetch(request)
          .then((response) => {
            if (response && response.ok && response.type === "basic") cache.put(request, response.clone());
          })
          .catch(() => {});
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response && response.ok && response.type === "basic") await cache.put(request, response.clone());
        return response;
      } catch {
        return new Response("离线，而且这页还没有缓存。连上网络打开一次后再试。", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })(),
  );
});
