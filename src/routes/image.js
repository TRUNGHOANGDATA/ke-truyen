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

/**
 * Danh sách referer để thử, theo thứ tự rẻ nhất trước:
 *  1. referer ĐÃ HỌC cho host này (lần trước lấy được ảnh) -> thường trúng ngay;
 *  2. referer mặc định theo host;
 *  3. base của các nguồn đang đăng ký (CDN của họ chống hotlink theo đúng trang
 *     nguồn — nên khi nguồn đổi host ảnh, ảnh vẫn không vỡ).
 * Tách ra ngoài để trang chẩn đoán thử ĐÚNG những gì proxy thật sự thử.
 */
export function buildReferers(u, { refererFor, altReferer, refererHints } = {}) {
  const list = [];
  const known = refererHints?.get?.(u);
  if (known) list.push(known);
  try { list.push(refererFor ? refererFor(u) : new URL(u).origin + '/'); } catch { /* URL lạ */ }
  const alt = typeof altReferer === 'function' ? altReferer() : altReferer;
  for (const a of [].concat(alt || [])) if (a) list.push(a);
  return [...new Set(list.filter(Boolean))];
}

/** Các host mang cùng đường dẫn ảnh — host này chết thì thử host kia. */
export const MIRROR_HOSTS = ['images.truyenonline.cc', 'sv1.otruyencdn.com', 'otruyencdn.com'];

export function mirrorsFor(u) {
  const list = [u];
  try {
    const parsed = new URL(u);
    if (MIRROR_HOSTS.includes(parsed.hostname)) {
      for (const h of MIRROR_HOSTS) {
        if (h === parsed.hostname) continue;
        const alt = new URL(u); alt.hostname = h; list.push(alt.href);
      }
    }
  } catch { /* URL lạ: chỉ dùng nguyên bản */ }
  return list;
}

// Một lời gọi /img không bao giờ được vượt quá ngần này, kể cả khi phải thử
// nhiều host/referer — người đọc thà thấy ảnh lỗi còn hơn ngồi chờ.
const TOTAL_BUDGET_MS = 14000;
const ATTEMPT_MS = 7000;

export function mountImageProxy(app, { fetchFn = fetch, cache, allowSuffixes, isAllowed, refererFor, altReferer, refererHints, limiter, archive, drive }) {
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

    const candidatesFor = mirrorsFor;

    // Gọi lên CDN, nhưng XẾP HÀNG theo host: trang đọc nạp trước rất hăng, dội cả
    // chùm vào một CDN thì bị chặn bớt -> ảnh vỡ lỗ chỗ, dù thử lẻ từng ảnh vẫn ngon.
    async function fetchOnce(u, referer, timeoutMs) {
      const call = async () => {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
          return await fetchFn(u, { headers: { ...headers, Referer: referer }, signal: ctrl.signal });
        } finally { clearTimeout(t); }
      };
      if (!limiter) return call();
      let host = '';
      try { host = new URL(u).hostname; } catch { /* URL lạ: không xếp hàng */ }
      return host ? limiter.run(host, call) : call();
    }

    const referersFor = (u) => buildReferers(u, { refererFor, altReferer, refererHints });

    // Thử host × referer. Chia theo TẦNG LỖI, không theo mã HTTP:
    //  - Không nối được / quá hạn  -> host chết, referer nào cũng vậy -> sang host khác.
    //  - Có trả lời nhưng lỗi      -> host sống, có thể do referer -> thử referer tiếp.
    // Nhờ vậy một host chết chỉ tốn 1 lần thử (trước đây 3 host x 5 referer x 8s
    // = tới 80 giây thật đo được), mà vẫn quét đủ referer trên host còn sống.
    const deadline = Date.now() + TOTAL_BUDGET_MS;
    const candidates = candidatesFor(url);
    nextHost:
    for (const u of candidates) {
      for (const ref of referersFor(u)) {
        const left = deadline - Date.now();
        if (left < 700) break nextHost;               // hết giờ: thà báo lỗi sớm
        let upstream;
        try {
          upstream = await fetchOnce(u, ref, Math.min(ATTEMPT_MS, left));
        } catch {
          continue nextHost;                          // host không phản hồi
        }
        if (upstream.ok) {
          const contentType = upstream.headers.get('content-type') || 'image/jpeg';
          const buf = Buffer.from(await upstream.arrayBuffer());
          refererHints?.set?.(u, ref);        // nhớ tổ hợp vừa ăn -> ảnh sau đi thẳng
          cache.put(url, buf, contentType);   // cache theo URL gốc
          return send(buf, contentType);
        }
        // Máy chủ CÓ trả lời (dù mã gì) = host còn sống -> đáng thử referer khác.
        // Đừng đoán mã nào là "chặn hotlink": mỗi CDN từ chối một kiểu (403, 404,
        // 429, trang lỗi...). Đoán hẹp là không bao giờ tới được referer đúng.
      }
    }
    return res.status(502).end();
  });
}
