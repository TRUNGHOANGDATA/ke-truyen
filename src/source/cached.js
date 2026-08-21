const MIN = 60 * 1000;

/**
 * Bọc ComicSource bằng cache trong SQLite (bảng api_cache).
 * - Trang chủ giờ có nhiều hàng thể loại; không cache thì mỗi lần mở trang
 *   là hơn 10 request tới nguồn.
 * - Nếu nguồn lỗi mà còn dữ liệu cũ trong cache thì dùng dữ liệu cũ
 *   (thà hiện hơi cũ còn hơn trang trắng).
 */
export function withCache(db, source, { ttlMs = 30 * MIN, keyPrefix = '' } = {}) {
  const K = (k) => keyPrefix + k;
  const getRow = db.prepare('SELECT payload, expires_at FROM api_cache WHERE cache_key=?');
  const putRow = db.prepare(`
    INSERT INTO api_cache (cache_key, payload, expires_at) VALUES (?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at
  `);
  const sweep = db.prepare('DELETE FROM api_cache WHERE expires_at < ?');

  async function cached(key, fn, ttl = ttlMs) {
    const now = Date.now();
    const row = getRow.get(key);
    if (row && row.expires_at > now) {
      try { return JSON.parse(row.payload); } catch { /* hỏng thì lấy lại */ }
    }
    try {
      const value = await fn();
      putRow.run(key, JSON.stringify(value), now + ttl);
      if (Math.random() < 0.02) sweep.run(now); // dọn bản hết hạn thưa thớt
      return value;
    } catch (err) {
      if (row) { try { return JSON.parse(row.payload); } catch { /* bỏ qua */ } }
      throw err;
    }
  }

  return {
    ...source,
    // v2: đổi khoá để bỏ bản cache cũ (trước đây thiếu tham số sắp xếp)
    // keyPrefix tách cache theo nguồn (nguồn tranh vs truyện chữ dùng chung bảng api_cache).
    home: () => cached(K('home:v2'), () => source.home()),
    list: (type = 'truyen-moi', page = 1) => cached(K(`list:v2:${type}:${page}`), () => source.list(type, page)),
    byCategory: (slug, page = 1) => cached(K(`cat:v2:${slug}:${page}`), () => source.byCategory(slug, page)),
    categories: () => cached(K('categories'), () => source.categories(), 24 * 60 * MIN),
    // detail / chapter / search giữ nguyên: cần dữ liệu mới nhất
  };
}
