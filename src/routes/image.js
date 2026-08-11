export function isAllowedHost(url, allowSuffixes) {
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  return allowSuffixes.some(s => host === s || host.endsWith('.' + s) || host.endsWith(s));
}

export function mountImageProxy(app, { fetchFn = fetch, cache, allowSuffixes }) {
  app.get('/img', async (req, res) => {
    const url = req.query.u;
    if (!url || !isAllowedHost(url, allowSuffixes)) return res.status(403).end();

    const cached = cache.get(url);
    if (cached) {
      res.set('Content-Type', cached.contentType);
      res.set('Cache-Control', 'public, max-age=604800');
      return res.end(cached.buf);
    }
    try {
      const referer = new URL(url).origin + '/';
      const upstream = await fetchFn(url, { headers: { Referer: referer, 'user-agent': 'web-truyen/1.0' } });
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
