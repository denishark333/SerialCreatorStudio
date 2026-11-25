/*
 * Service worker of the Creator Studio PWA. It only makes the app installable and shows the last loaded shell
 * when the network is down: navigations go to the network first (always the newest deploy) and fall back to the
 * cached page. Nothing else is cached — API calls go to another origin and are never touched, so no account data
 * is stored by the worker.
 */
// v2: earlier versions cached any navigation as the app shell (e.g. /privacidade/ would replace it).
const CACHE = 'creator-studio-shell-v2';
/** Only the app itself is the offline shell; other pages (/privacidade/, /termos/) are never cached. */
const isShell = url => url.pathname === '/' || url.pathname === '/index.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add('/')));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.mode !== 'navigate' || url.origin !== self.location.origin || !isShell(url)) return;
  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE).then(cache => cache.put('/', copy));
        }
        return response;
      })
      .catch(() => caches.match('/').then(cached => cached ?? Response.error())),
  );
});
