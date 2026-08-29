// Lets the app open with no connection: the last-loaded page, manifest, and
// fonts are cached, and the dose timer runs entirely off localStorage
// regardless of connectivity — nothing here touches that.
//
// Every same-origin request still prefers the network first, so a reload
// while online always gets the latest deploy; only a failed network request
// falls back to the cached copy. That also means there is no version number
// to remember to bump on future deploys — the cache just keeps refreshing
// itself whenever the network is reachable.
const CACHE = 'g-tracker-shell-v1';
const SHELL_URLS = ['./index.html', './manifest.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Not cache.addAll — that rejects the whole install if even one URL
      // fails, which would leave nothing cached at all. Each URL is fetched
      // on its own so a single hiccup doesn't take out offline support.
      Promise.all(
        SHELL_URLS.map((url) =>
          fetch(url).then((res) => (res.ok ? cache.put(url, res) : null)).catch(() => {})
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Google Fonts is the only cross-origin request worth caching — it's static
// per URL and keeps the offline page looking right instead of falling back
// to a system font. Everything else cross-origin (GitHub, ntfy, n8n) is a
// live API call and must never be served from cache.
const CACHEABLE_CROSS_ORIGIN = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // backup PATCH calls etc. go straight to network

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_CROSS_ORIGIN.includes(url.hostname)) return;

  if (sameOrigin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
    );
  } else {
    // Fonts: serve the cached copy instantly, refresh it in the background.
    e.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            caches.open(CACHE).then((cache) => cache.put(req, res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
  }
});
