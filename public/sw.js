const CACHE = "assistente-medicacao-v1.0-cf";
const APP_SHELL = "./";
const ASSETS = [
  APP_SHELL,
  "./styles.css?v=1.0",
  "./mm-registro.css?v=4.0",
  "./mm-registro-icons.svg",
  "./mm-registro-i18n.js?v=4.0",
  "./i18n.js?v=1.0",
  "./mm-registro.js?v=4.0",
  "./native-runtime.js?v=1.0",
  "./app.js?v=1.0",
  "./manifest.webmanifest?v=1.0",
  "./privacy.html",
  "./support.html",
  "./icons/icon-180.png?v=1.0",
  "./icons/icon-192.png?v=1.0",
  "./icons/icon-512.png?v=1.0",
  "./icons/icon-maskable-512.png?v=1.0"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: "no-store" });
    if (response && response.status === 200) {
      const cache = await caches.open(CACHE);
      // Every successful navigation refreshes the same canonical app-shell
      // entry. This avoids separate offline identities for /, /?v=... and
      // /index.html while preserving compatibility with old bookmarks.
      if (request.mode === "navigate") await cache.put(APP_SHELL, response.clone());
      else await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.mode === "navigate") {
      const shell = await caches.match(APP_SHELL);
      if (shell) return shell;
    }
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const isAppResource =
    event.request.mode === "navigate" ||
    ["script", "style", "manifest"].includes(event.request.destination) ||
    /\.(?:js|css|webmanifest)$/i.test(url.pathname);

  if (isAppResource) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (!response || response.status !== 200) return response;
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy));
      return response;
    }))
  );
});
