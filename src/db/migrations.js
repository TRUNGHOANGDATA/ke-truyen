export function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS comics (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      thumb_url TEXT,
      status TEXT,
      categories TEXT,
      last_chapter_seen TEXT,
      updated_at_source TEXT,
      followed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      comic_slug TEXT NOT NULL,
      chapter_name TEXT NOT NULL,
      chapter_title TEXT,
      api_url TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (comic_slug, chapter_name)
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      comic_slug TEXT PRIMARY KEY,
      chapter_name TEXT NOT NULL,
      image_page INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chapters_comic ON chapters(comic_slug, order_index);

    -- Ảnh đã lưu lên Google Drive. Khoá theo URL gốc để proxy tra được ngay.
    CREATE TABLE IF NOT EXISTS archive (
      src_url TEXT PRIMARY KEY,
      comic_slug TEXT NOT NULL,
      chapter_name TEXT NOT NULL,
      image_page INTEGER NOT NULL,
      drive_id TEXT NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_archive_comic ON archive(comic_slug, chapter_name);

    -- Trạng thái lưu offline theo từng truyện
    CREATE TABLE IF NOT EXISTS archive_jobs (
      comic_slug TEXT PRIMARY KEY,
      state TEXT NOT NULL,              -- queued | running | done | error | cancelled
      done_chapters INTEGER NOT NULL DEFAULT 0,
      total_chapters INTEGER NOT NULL DEFAULT 0,
      bytes INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      updated_at INTEGER NOT NULL
    );

    -- Đếm lượt mở từng thể loại để warmer tự làm ấm những thể loại hay xem.
    CREATE TABLE IF NOT EXISTS category_hits (
      slug TEXT PRIMARY KEY,
      hits INTEGER NOT NULL DEFAULT 0,
      last_at INTEGER NOT NULL
    );
  `);

  // Tách "có trong thư viện" khỏi "đang theo dõi": mở một truyện để đọc cũng
  // tạo dòng trong comics (followed = 0) để còn hiện ở mục "Đang đọc dở".
  // DB cũ đã có bảng comics nên phải thêm cột bằng ALTER.
  const cols = db.prepare('PRAGMA table_info(comics)').all().map(c => c.name);
  if (!cols.includes('followed')) {
    db.exec('ALTER TABLE comics ADD COLUMN followed INTEGER NOT NULL DEFAULT 1');
  }
}
