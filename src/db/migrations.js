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
  `);
}
