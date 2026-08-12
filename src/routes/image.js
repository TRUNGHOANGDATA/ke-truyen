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

export function mountImageProxy(app, { fetchFn = fetch, cache, allowSuffixes, refererFor }) {
  app.get('/img', async (req, res) => {
    // ?i= là URL đã gói (mặc định); ?u= giữ lại cho tương thích
    const url = req.query.i ? unpackImg(req.query.i) : req.query.u;
    if (!url || !isAllowedHost(url, allowSuffixes)) return res.status(403).end();

    const cached = cache.get(url);
    if (cached) {
      res.set('Content-Type', cached.contentType);
      res.set('Cache-Control', 'public, max-age=604800');
      return res.end(cached.buf);
    }
    try {
      const referer = refererFor ? refererFor(url) : new URL(url).origin + '/';
      const upstream = await fetchFn(url, {
        headers: {
          Referer: referer,
          // CDN truyện thường chặn user-agent lạ
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        },
      });
      if (!upstream.ok) return res.status(502).end();
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      const buf = Buffer.from(await upstream.arrayBuffer());
      cache.put(url, buf, contentType);
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=604800');
      res.end(buf);
    } catch {
      res.status(502).end();
    }
  });
}
