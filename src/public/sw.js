const SHELL = 'shell-v1';
const ASSETS = ['/public/css/styles.css', '/public/js/common.js', '/public/js/home.js', '/public/js/reader.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/public/')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
  // API and /img always go to network (auth-gated, fresh)
});
