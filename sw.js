// Offline cache for the installed (Home Screen) game.
const CACHE = 'ww2-sunshine-v1';
const FILES = ['./', 'index.html', 'style.css', 'manifest.json', 'js/main.js', 'js/game.js', 'js/map.js', 'js/models.js', 'vendor/three.module.min.js', 'data/map.json', 'data/sunshine_sat.jpg', 'data/minimap.jpg', 'icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => { e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request))); });
