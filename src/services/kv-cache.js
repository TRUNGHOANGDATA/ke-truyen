/**
 * Cache khoá-giá trị dùng chung, nằm trên bảng `api_cache` (như [source/cached.js]
 * nhưng cho dữ liệu KHÔNG phải kết quả của một ComicSource).
 *
 * Dùng cho những phép tra cứu đắt mà kết quả rất ít đổi — ví dụ "bộ này có ở
 * những nguồn nào": phải gọi search() tới từng nguồn (~3 giây), trong khi câu
 * trả lời gần như cố định theo từng bộ truyện.
 */
export function createKvCache(db, { prefix = '' } = {}) {
  const getRow = db.prepare('SELECT payload, expires_at FROM api_cache WHERE cache_key=?');
  const putRow = db.prepare(`
    INSERT INTO api_cache (cache_key, payload, expires_at) VALUES (?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, expires_at=excluded.expires_at
  `);

  return {
    get(key) {
      const row = getRow.get(prefix + key);
      if (!row || row.expires_at <= Date.now()) return undefined;
      try { return JSON.parse(row.payload); } catch { return undefined; }
    },

    set(key, value, ttlMs) {
      try { putRow.run(prefix + key, JSON.stringify(value), Date.now() + ttlMs); }
      catch { /* cache hỏng thì bỏ qua, không được làm chết request */ }
      return value;
    },

    /** Lấy từ cache, chưa có thì gọi fn() rồi nhớ lại. Lỗi thì KHÔNG cache. */
    async wrap(key, ttlMs, fn) {
      const hit = this.get(key);
      if (hit !== undefined) return hit;
      return this.set(key, await fn(), ttlMs);
    },
  };
}
