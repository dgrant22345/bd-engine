const ASSET_VERSION = '20260425-v0-polish-setup-bg-4';
const CACHE_NAME = `bd-engine-${ASSET_VERSION}`;
const SHELL_FILES = [
  '/',
  '/index.html',
  `/styles.css?v=${ASSET_VERSION}`,
  `/app.js?v=${ASSET_VERSION}`,
  `/local-api.js?v=${ASSET_VERSION}`,
  '/manifest.json',
];

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API and shell, cache fallback for offline use
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network only (don't cache dynamic data)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Offline', message: 'You are offline. API requests require a network connection.' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Static assets: prefer fresh local files so UI/code changes are visible immediately.
  event.respondWith(
    fetch(event.request).then((response) => {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(() =>
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return caches.match(url.pathname).then((pathCached) => {
          if (pathCached) return pathCached;
          return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        });
      })
    )
  );
});
