export function createLibrary(db) {
  const upsertComic = db.prepare(`
    INSERT INTO comics (slug, name, thumb_url, status, categories, last_chapter_seen, updated_at_source, followed_at)
    VALUES (@slug, @name, @thumb_url, @status, @categories, @last_chapter_seen, @updated_at_source, @followed_at)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, thumb_url=excluded.thumb_url, status=excluded.status,
      categories=excluded.categories, last_chapter_seen=excluded.last_chapter_seen,
      updated_at_source=excluded.updated_at_source
  `);
  const delChapters = db.prepare('DELETE FROM chapters WHERE comic_slug=?');
  const insChapter = db.prepare(`
    INSERT INTO chapters (comic_slug, chapter_name, chapter_title, api_url, order_index)
    VALUES (?,?,?,?,?)
    ON CONFLICT(comic_slug, chapter_name) DO UPDATE SET
      chapter_title=excluded.chapter_title, api_url=excluded.api_url, order_index=excluded.order_index
  `);

  const setFollowed = db.prepare('UPDATE comics SET followed=? WHERE slug=?');

  // Ghi truyện vào thư viện. followed=1 khi bấm "Theo dõi"; followed=0 khi chỉ
  // mở ra đọc (để còn hiện ở "Đang đọc dở" mà không coi là đang theo dõi).
  const save = db.transaction((detail, followed) => {
    const latest = detail.chapters.at(-1)?.name ?? null;
    upsertComic.run({
      slug: detail.slug, name: detail.name, thumb_url: detail.thumbUrl,
      status: detail.status, categories: (detail.categories || []).join(', '),
      last_chapter_seen: latest, updated_at_source: detail.updatedAt || null,
      followed_at: Date.now(),
    });
    if (followed !== null) setFollowed.run(followed ? 1 : 0, detail.slug);
    for (const c of detail.chapters) {
      insChapter.run(detail.slug, c.name, c.title || '', c.apiUrl, c.order);
    }
  });

  const decorate = (c) => {
    const total = db.prepare('SELECT COUNT(*) n FROM chapters WHERE comic_slug=?').get(c.slug).n;
    const prog = db.prepare('SELECT * FROM reading_progress WHERE comic_slug=?').get(c.slug);
    let readCount = 0;
    if (prog) {
      const ord = db.prepare('SELECT order_index FROM chapters WHERE comic_slug=? AND chapter_name=?')
        .get(c.slug, prog.chapter_name);
      readCount = ord ? ord.order_index + 1 : 0;
    }
    return { ...c, totalChapters: total, readCount, unread: Math.max(0, total - readCount),
             progress: prog ? { chapterName: prog.chapter_name, imagePage: prog.image_page } : null };
  };

  return {
    follow: (detail) => save(detail, true),
    /** Chỉ ghi nhớ để đọc tiếp, không đánh dấu theo dõi (giữ nguyên nếu đã theo). */
    remember(detail) {
      const existing = db.prepare('SELECT followed FROM comics WHERE slug=?').get(detail.slug);
      save(detail, existing ? null : false);
    },
    unfollow(slug) {
      const prog = db.prepare('SELECT 1 FROM reading_progress WHERE comic_slug=?').get(slug);
      if (prog) {
        setFollowed.run(0, slug); // còn đang đọc dở thì giữ lại lịch sử đọc
      } else {
        db.prepare('DELETE FROM comics WHERE slug=?').run(slug);
        delChapters.run(slug);
      }
    },
    /** Xoá khỏi "Đang đọc dở". Không theo dõi nữa thì bỏ hẳn khỏi thư viện. */
    clearProgress(slug) {
      db.prepare('DELETE FROM reading_progress WHERE comic_slug=?').run(slug);
      const row = db.prepare('SELECT followed FROM comics WHERE slug=?').get(slug);
      if (row && !row.followed) {
        db.prepare('DELETE FROM comics WHERE slug=?').run(slug);
        delChapters.run(slug);
      }
    },
    isFollowed(slug) {
      const row = db.prepare('SELECT followed FROM comics WHERE slug=?').get(slug);
      return !!(row && row.followed);
    },
    inLibrary(slug) {
      return !!db.prepare('SELECT 1 FROM comics WHERE slug=?').get(slug);
    },
    /** Truyện đang đọc dở — không phụ thuộc việc có theo dõi hay không. */
    listReading() {
      return db.prepare(`
        SELECT c.* FROM comics c
        JOIN reading_progress p ON p.comic_slug = c.slug
        ORDER BY p.updated_at DESC
      `).all().map(decorate);
    },
    /** Truyện cần kiểm tra chương mới: đang theo dõi HOẶC đang đọc dở. */
    listTracked() {
      return db.prepare(`
        SELECT c.* FROM comics c
        WHERE c.followed = 1
           OR EXISTS (SELECT 1 FROM reading_progress p WHERE p.comic_slug = c.slug)
        ORDER BY c.followed_at DESC
      `).all().map(decorate);
    },
    listFollowed() {
      return db.prepare('SELECT * FROM comics WHERE followed=1 ORDER BY followed_at DESC')
        .all().map(decorate);
    },
    setProgress(slug, chapterName, imagePage = 0) {
      db.prepare(`
        INSERT INTO reading_progress (comic_slug, chapter_name, image_page, updated_at)
        VALUES (?,?,?,?)
        ON CONFLICT(comic_slug) DO UPDATE SET
          chapter_name=excluded.chapter_name, image_page=excluded.image_page, updated_at=excluded.updated_at
      `).run(slug, chapterName, imagePage, Date.now());
    },
    getProgress(slug) {
      const p = db.prepare('SELECT * FROM reading_progress WHERE comic_slug=?').get(slug);
      return p ? { chapterName: p.chapter_name, imagePage: p.image_page } : null;
    },
    chaptersOf(slug) {
      return db.prepare('SELECT * FROM chapters WHERE comic_slug=? ORDER BY order_index').all(slug);
    },
    /** Ghi nhận mở một thể loại (để warmer tự làm ấm thể loại hay xem). */
    recordCategoryHit(slug) {
      if (!slug) return;
      db.prepare(`
        INSERT INTO category_hits (slug, hits, last_at) VALUES (?, 1, ?)
        ON CONFLICT(slug) DO UPDATE SET hits = hits + 1, last_at = excluded.last_at
      `).run(slug, Date.now());
    },
    /** N thể loại được mở nhiều nhất (gần đây ưu tiên khi bằng điểm). */
    topCategories(n = 10) {
      return db.prepare('SELECT slug FROM category_hits ORDER BY hits DESC, last_at DESC LIMIT ?')
        .all(n).map(r => r.slug);
    },

    /**
     * Dọn khỏi thư viện mọi truyện có slug mang một trong các TIỀN TỐ cho trước
     * (dùng khi bỏ nguồn bổ sung: xoá các bộ ot~/nar~/nx~... không thuộc TruyenQQ).
     * Xoá cả tiến độ đọc + mục lục đã lưu. Trả về số bộ đã xoá.
     */
    purgeByPrefixes(prefixes = []) {
      const pres = prefixes.filter(Boolean);
      if (!pres.length) return 0;
      const slugs = db.prepare('SELECT slug FROM comics').all()
        .map(r => r.slug).filter(sl => pres.some(p => sl.startsWith(p)));
      const delC = db.prepare('DELETE FROM comics WHERE slug=?');
      const delP = db.prepare('DELETE FROM reading_progress WHERE comic_slug=?');
      const delCh = db.prepare('DELETE FROM chapters WHERE comic_slug=?');
      const tx = db.transaction((list) => {
        for (const sl of list) { delP.run(sl); delCh.run(sl); delC.run(sl); }
      });
      tx(slugs);
      return slugs.length;
    },
  };
}
