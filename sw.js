const CACHE = 'takken-v2';
const ASSETS = [
  '/takken-study/',
  '/takken-study/index.html',
  '/takken-study/app.js',
  '/takken-study/style.css',
  '/takken-study/questions.js',
  '/takken-study/flashcards.js',
  '/takken-study/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
