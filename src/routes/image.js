/**
 * Gói URL ảnh lại để mã trang không lộ host CDN của nguồn.
 * Chỉ là base64url (không phải bảo mật) — mục đích là không hiện thẳng ra.
 */
export const packImg = (url) => Buffer.from(String(url || ''), 'utf8').toString('base64url');
export const unpackImg = (s) => {
  try { return Buffer.from(String(s || ''), 'base64url').toString('utf8'); } catch { return ''; }
};

export function isAllowedHost(url, allowSuffixes) {
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  return allowSuffixes.some(s => host === s || host.endsWith('.' + s) || host.endsWith(s));
}

export function mountImageProxy(app, { fetchFn = fetch, cache, allowSuffixes, isAllowed, refererFor, altReferer, archive, drive }) {
  const allow = isAllowed || ((u) => isAllowedHost(u, allowSuffixes || []));
  app.get('/img', async (req, res) => {
    // ?i= là URL đã gói (mặc định); ?u= giữ lại cho tương thích
    const url = req.query.i ? unpackImg(req.query.i) : req.query.u;
    if (!url || !allow(url)) return res.status(403).end();

    const send = (buf, contentType) => {
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=604800');
      res.end(buf);
    };

    const cached = cache.get(url);
    if (cached) return send(cached.buf, cached.contentType);

    // Đã lưu trên Drive thì đọc từ đó — nguồn có chết vẫn đọc được
    if (archive && drive?.configured) {
      const saved = archive.lookup(url);
      if (saved) {
        try {
          const { buf, contentType } = await drive.download(saved.drive_id);
          cache.put(url, buf, contentType);
          return send(buf, contentType);
        } catch { /* Drive lỗi thì rơi xuống lấy từ nguồn */ }
      }
    }
    const headers = {
      // CDN truyện thường chặn user-agent lạ
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
    };

    // Ảnh chương kho bổ sung có mặt trên nhiều host cùng đường dẫn; nếu host này
    // chậm/chết thì thử host kia (giảm "mất ảnh" khi 1 CDN chập chờn từ máy chủ).
    const MIRRORS = ['images.truyenonline.cc', 'sv1.otruyencdn.com', 'otruyencdn.com'];
    function candidatesFor(u) {
      const list = [u];
      try {
        const parsed = new URL(u);
        if (MIRRORS.includes(parsed.hostname)) {
          for (const h of MIRRORS) {
            if (h === parsed.hostname) continue;
            const alt = new URL(u); alt.hostname = h; list.push(alt.href);
          }
        }
      } catch { /* URL lạ: chỉ dùng nguyên bản */ }
      return list;
    }

    async function fetchOnce(u, referer, timeoutMs) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetchFn(u, { headers: { ...headers, Referer: referer }, signal: ctrl.signal });
      } finally { clearTimeout(t); }
    }

    // Danh sách referer để thử: referer mặc định, rồi referer TruyenQQ (nhiều CDN
    // ảnh của TruyenQQ chống hotlink theo trang chủ; khi họ đổi host mới, host đó
    // chưa khớp refererFor nên thử thêm referer TruyenQQ để không vỡ ảnh).
    function referersFor(u) {
      const list = [refererFor ? refererFor(u) : new URL(u).origin + '/'];
      const alt = typeof altReferer === 'function' ? altReferer() : altReferer;
      if (alt && !list.includes(alt)) list.push(alt);
      return list;
    }

    // Thử lần lượt: từng host mirror × từng referer, tới khi lấy được ảnh.
    const candidates = candidatesFor(url);
    for (const u of candidates) {
      for (const ref of referersFor(u)) {
        try {
          const upstream = await fetchOnce(u, ref, 8000);
          if (!upstream.ok) continue;      // referer/host này chưa được -> thử tiếp
          const contentType = upstream.headers.get('content-type') || 'image/jpeg';
          const buf = Buffer.from(await upstream.arrayBuffer());
          cache.put(url, buf, contentType);   // cache theo URL gốc
          return send(buf, contentType);
        } catch { /* thử tổ hợp kế tiếp */ }
      }
    }
    return res.status(502).end();
  });
}
