/* Copaz service worker — cache offline + actualización automática. */
const CACHE = 'copaz-v30';

self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Copaz', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: d.url || './', tag: d.tag, vibrate: [80, 40, 80],
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
const ASSETS = [
  './', './index.html', './app.css', './app.js', './api-client.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Permite que la página pida activar la nueva versión de inmediato.
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// Estrategia "stale-while-revalidate": responde al instante desde el caché
// y en segundo plano baja la versión nueva para la próxima carga. Así la app
// se mantiene sola al día sin que el usuario tenga que limpiar nada.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // no tocar el backend (API/WebSocket)
  // El panel admin y las páginas informativas van siempre por la red primero
  // (network-first) para no mostrar nunca una versión vieja.
  const netFirst = /\/(admin|landing|terminos|privacidad)\.html$/.test(url.pathname);
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (netFirst) {
      try {
        const res = await fetch(e.request);
        if (res && res.status === 200) cache.put(e.request, res.clone());
        return res;
      } catch { return (await cache.match(e.request)) || cache.match('./index.html'); }
    }
    const cached = await cache.match(e.request);
    const network = fetch(e.request).then(res => {
      if (res && res.status === 200) cache.put(e.request, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || cache.match('./index.html');
  })());
});
