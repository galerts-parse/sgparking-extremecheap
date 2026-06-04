// SG ParkExtreme Cheap - PWA Service Worker
const CACHE_NAME = 'sg-park-cache-v3';
const ASSETS = [
  'index.html',
  'index.css',
  'app.js',
  'pricing.js',
  'manifest.json',
  'data/hdb_carparks.js',
  'data/commercial_carparks.js',
  // Cache CDN assets to enable true offline startup
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install Event - Pre-cache assets
self.addEventListener('install', (e) => {
  console.log('[Service Worker] Installing and caching assets...');
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (e) => {
  console.log('[Service Worker] Activating...');
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Serve from Cache, Fallback to Network
self.addEventListener('fetch', (e) => {
  // Only cache GET requests
  if (e.request.method !== 'GET') return;
  
  // Skip external APIs (OSM, Data.gov.sg, OSRM) to ensure they always get real-time info
  const url = e.request.url;
  if (url.includes('api.data.gov.sg') || url.includes('nominatim.openstreetmap.org') || url.includes('project-osrm.org')) {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Serve from cache but fetch fresh asset in the background (Stale-While-Revalidate)
          fetch(e.request)
            .then(networkResponse => {
              if (networkResponse.status === 200) {
                caches.open(CACHE_NAME).then(cache => cache.put(e.request, networkResponse));
              }
            })
            .catch(() => {/* Ignore network errors offline */});
            
          return cachedResponse;
        }
        
        // Fallback to network
        return fetch(e.request).then(networkResponse => {
          if (networkResponse.status === 200) {
            const responseCopy = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, responseCopy));
          }
          return networkResponse;
        });
      })
  );
});
