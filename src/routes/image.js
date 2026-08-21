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

export function mountImageProxy(app, { fetchFn = fetch, cache, allowSuffixes, refererFor, archive, drive }) {
  app.get('/img', async (req, res) => {
    // ?i= là URL đã gói (mặc định); ?u= giữ lại cho tương thích
    const url = req.query.i ? unpackImg(req.query.i) : req.query.u;
    if (!url || !isAllowedHost(url, allowSuffixes)) return res.status(403).end();

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

    async function fetchOnce(u, timeoutMs) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const ref = refererFor ? refererFor(u) : new URL(u).origin + '/';
        return await fetchFn(u, { headers: { ...headers, Referer: ref }, signal: ctrl.signal });
      } finally { clearTimeout(t); }
    }

    // Thử lần lượt từng host (mỗi host 1 lần), host cuối được thêm 1 lần thử nữa.
    const candidates = candidatesFor(url);
    for (let i = 0; i < candidates.length; i++) {
      const last = i === candidates.length - 1;
      for (let attempt = 0; attempt < (last ? 2 : 1); attempt++) {
        try {
          const upstream = await fetchOnce(candidates[i], 8000);
          if (!upstream.ok) break;      // host này lỗi -> sang host khác
          const contentType = upstream.headers.get('content-type') || 'image/jpeg';
          const buf = Buffer.from(await upstream.arrayBuffer());
          cache.put(url, buf, contentType);   // cache theo URL gốc
          return send(buf, contentType);
        } catch {
          if (last && attempt === 0) continue;   // host cuối: thử lại 1 lần
        }
      }
    }
    return res.status(502).end();
  });
}
