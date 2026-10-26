/**
 * MeteoRiotuerto — Service Worker (EVO-021 / EVO-F)
 * Soporte de modo sin conexión (offline) y Progressive Web App (PWA).
 * Permite consultar almanaques, datos históricos y gráficos en el campo o zonas sin cobertura.
 */

const CACHE_NAME = 'meteoriotuerto-cache-v1.1.0';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './site.webmanifest',
  './favicon.svg',
  './favicon.ico',
  './favicon-16x16.png',
  './favicon-32x32.png',
  './favicon-48x48.png',
  './favicon-192x192.png',
  './favicon-512x512.png',
  './apple-touch-icon.png',
  './src/css/styles.css',
  './src/js/app.js',
  './src/js/vendor/xlsx.mini.min.js',
  './data/index.json',
  './data/records.json',
  './data/comparisons.json',
  './data/glossary.json',
  './data/station.geojson',
  './data/schema.json',
  './data/almanac_2022.json',
  './data/almanac_2023.json',
  './data/almanac_2024.json',
  './data/almanac_2025.json',
  './data/almanac_2026.json'
];

// Instalación: precachea todos los recursos críticos
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activación: limpia cachés antiguas y toma el control inmediato
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Intercepción de peticiones (estrategia Network-First con fallback a Cache para datos y Cache-First para CDNs)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Solo procesar peticiones HTTP/HTTPS con método GET
  if (req.method !== 'GET') return;

  // 1. Peticiones de navegación (HTML)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const resClone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return networkRes;
      }).catch(() => {
        return caches.match(req).then((cached) => cached || caches.match('./index.html'));
      })
    );
    return;
  }

  // 2. CDNs y recursos externos estáticos (Chart.js, Google Fonts): Cache-first con actualización en segundo plano
  if (url.origin !== self.location.origin) {
    if (url.hostname.includes('cdn.jsdelivr.net') || url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
      event.respondWith(
        caches.match(req).then((cached) => {
          const fetchPromise = fetch(req).then((networkRes) => {
            if (networkRes && networkRes.status === 200) {
              const resClone = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
            }
            return networkRes;
          }).catch(() => null);

          return cached || fetchPromise;
        })
      );
      return;
    }
  }

  // 3. Recursos locales (datos JSON, scripts, estilos e imágenes): Network-First con fallback a Cache
  event.respondWith(
    fetch(req).then((networkRes) => {
      if (networkRes && networkRes.status === 200) {
        const resClone = networkRes.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
      }
      return networkRes;
    }).catch(() => {
      return caches.match(req).then((cached) => {
        if (cached) return cached;
        // Fallback para imágenes no encontradas
        if (req.destination === 'image') {
          return caches.match('./favicon.svg');
        }
        return new Response('Recurso no disponible sin conexión', {
          status: 503,
          statusText: 'Service Unavailable (Offline)',
          headers: new Headers({ 'Content-Type': 'text/plain;charset=utf-8' })
        });
      });
    })
  );
});
