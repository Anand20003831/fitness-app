// Service worker. Keeps the app opening instantly with no signal, which is the
// point, since the gym has none.
//
// Bump CACHE when you change the files below. Old caches are deleted on
// activate, so a stale version cannot survive an update.

const CACHE = 'fitness-v3';

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './plan.js',
  './store.js',
  './sync.js',
  './report.js',
  './calendar.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Added one at a time: addAll rejects the whole batch if a single file is
    // missing, and a module added in a later step should not break the install.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // His data and Google's scripts are never cached. A stale data.json would be
  // worse than no data.json, and the sync layer handles being offline itself.
  if (url.origin !== self.location.origin) return;

  // Navigations fall back to the cached shell so a cold offline start works.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Stale while revalidate: paint from cache immediately, refresh underneath.
  // He gets an instant open now and the new version on the next launch.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
