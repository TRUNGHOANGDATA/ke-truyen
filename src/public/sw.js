// Service worker: vỏ web + ĐỌC OFFLINE.
// - Vỏ (CSS/JS/font) trong /public: stale-while-revalidate.
// - Ảnh (/img): cache-first (ảnh bất biến) -> đọc lại chương cũ khi mất mạng + nhanh.
// - Trang đọc/chi tiết: network-first, mất mạng thì lấy bản đã lưu; không có thì
//   hiện trang "offline" gọn.
const SHELL = 'shell-v18';
const PAGES = 'pages-v1';
const IMGS = 'imgs-v1';
const ASSETS = ['/public/css/styles.css', '/public/js/common.js', '/public/js/home.js', '/public/js/reader.js', '/public/js/reader-novel.js'];
const IMG_MAX = 500;    // ~15-20 chuong gan nhat (~100MB), anh cu tu xoa -> khong day may

// Trang được lưu để đọc offline (đọc chương + chi tiết + trang chủ). KHÔNG lưu
// login/logout/api để tránh kẹt phiên hay dữ liệu cũ.
const PAGE_RE = /^\/(doc|doc-chu|truyen|chu|following|browse)(\/|$)|^\/$/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  const keep = new Set([SHELL, PAGES, IMGS]);
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Giữ cache ảnh không phình: quá IM_MAX thì xoá bớt ảnh cũ nhất (theo thứ tự thêm).
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

const offlinePage = () => new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Ngoại tuyến</title><body style="font-family:system-ui;background:#0B0A0D;color:#eee;display:grid;place-items:center;height:100vh;margin:0;text-align:center;padding:24px">' +
  '<div><div style="font-size:40px">📶</div><h2>Đang ngoại tuyến</h2>' +
  '<p style="color:#9C98A6">Chương này chưa được lưu để đọc offline.<br>Kết nối mạng rồi thử lại.</p>' +
  '<a href="/" style="color:#FF2E55">← Trang chủ</a></div></body>',
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                    // POST (tiến độ, login...) -> mạng
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // nguồn ngoài -> để trình duyệt lo

  // Vỏ web: trả cache ngay + cập nhật nền
  if (url.pathname.startsWith('/public/')) {
    e.respondWith(caches.open(SHELL).then(async (cache) => {
      const cached = await cache.match(req);
      const network = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    }));
    return;
  }

  // Ảnh: cache-first (ảnh không đổi) -> đọc lại offline + nhanh
  if (url.pathname === '/img') {
    e.respondWith(caches.open(IMGS).then(async (cache) => {
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) { cache.put(req, res.clone()); trim(IMGS, IMG_MAX); }
        return res;
      } catch { return cached || Response.error(); }
    }));
    return;
  }

  // Trang đọc/chi tiết: network-first, mất mạng -> bản đã lưu -> trang offline
  if (PAGE_RE.test(url.pathname)) {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        // Chỉ lưu trang thật (không phải chuyển hướng về /login)
        if (res && res.ok && !res.redirected) (await caches.open(PAGES)).put(req, res.clone());
        return res;
      } catch {
        const cached = await caches.match(req);
        return cached || offlinePage();
      }
    })());
  }
  // còn lại (/api, /login...) -> để mặc định ra mạng
});
