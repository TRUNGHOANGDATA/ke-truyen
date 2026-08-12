/**
 * Cấu hình chạy được sửa trong web (bảng settings key/value).
 * DB là nguồn chân lý lúc chạy; .env chỉ dùng để nạp lần đầu.
 */
export function createSettings(db) {
  const getStmt = db.prepare('SELECT value FROM settings WHERE key=?');
  const setStmt = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `);
  const allStmt = db.prepare('SELECT key, value FROM settings');

  const get = (key, fallback = null) => {
    const row = getStmt.get(key);
    return row ? row.value : fallback;
  };
  const set = (key, value) => { setStmt.run(key, String(value)); };
  const all = () => Object.fromEntries(allStmt.all().map(r => [r.key, r.value]));

  /** Nạp giá trị mặc định cho các key còn thiếu (không ghi đè key đã có). */
  const seedDefaults = (defaults = {}) => {
    for (const [k, v] of Object.entries(defaults)) {
      if (v != null && getStmt.get(k) === undefined) set(k, v);
    }
  };

  return { get, set, all, seedDefaults };
}
