/**
 * OROS Mobility — Service Worker PWA
 * Cache statiques + fallback hors-ligne
 */
const CACHE = 'oros-v3';
const STATIC = [
  '/', '/index.html',
  '/css/app.css',
  '/js/api.js', '/js/app.js', '/js/map.js', '/js/pages.js',
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API → réseau uniquement (pas de cache)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return;
  // Tiles carte → cache réseau avec fallback
  if (url.hostname.includes('tile.openstreetmap.org') || url.hostname.includes('arcgisonline.com')) {
    e.respondWith(
      caches.open('oros-tiles').then(c =>
        c.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(resp => {
            if (resp.ok) c.put(e.request, resp.clone());
            return resp;
          }).catch(() => cached);
        })
      )
    );
    return;
  }
  // Statiques → cache first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() =>
      e.request.mode === 'navigate' ? caches.match('/index.html') : new Response('Hors ligne', {status:503})
    ))
  );
});
