const SHELL = 'shell-v2';
const ASSETS = ['/public/css/styles.css', '/public/js/common.js', '/public/js/home.js', '/public/js/reader.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/public/')) {
    // stale-while-revalidate: trả cache ngay cho nhanh, đồng thời tải bản mới về
    // cập nhật cache -> lần mở sau tự có bản mới (không cần nâng version SW).
    e.respondWith(caches.open(SHELL).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request).then((res) => {
        if (res && res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    }));
  }
  // API và /img luôn ra mạng (đã chặn bằng đăng nhập, cần dữ liệu mới)
});
