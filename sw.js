// Bandstem service worker: maakt de site installeerbaar en laadt hem ook bij slecht bereik.
// Altijd eerst het netwerk (zodat je meteen de nieuwste versie hebt), de cache alleen als reserve.
const CACHE = 'bandstem-v1';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/spotify.js', 'config.json', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  // Alleen eigen bestanden; Supabase, Spotify, lettertypes e.d. gaan rechtstreeks.
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('index.html')))
  );
});
