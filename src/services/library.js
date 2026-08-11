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

  const follow = db.transaction((detail) => {
    const latest = detail.chapters.at(-1)?.name ?? null;
    upsertComic.run({
      slug: detail.slug, name: detail.name, thumb_url: detail.thumbUrl,
      status: detail.status, categories: (detail.categories || []).join(', '),
      last_chapter_seen: latest, updated_at_source: detail.updatedAt || null,
      followed_at: Date.now(),
    });
    for (const c of detail.chapters) {
      insChapter.run(detail.slug, c.name, c.title || '', c.apiUrl, c.order);
    }
  });

  return {
    follow,
    unfollow(slug) {
      db.prepare('DELETE FROM comics WHERE slug=?').run(slug);
      delChapters.run(slug);
      db.prepare('DELETE FROM reading_progress WHERE comic_slug=?').run(slug);
    },
    isFollowed(slug) {
      return !!db.prepare('SELECT 1 FROM comics WHERE slug=?').get(slug);
    },
    listFollowed() {
      const comics = db.prepare('SELECT * FROM comics ORDER BY followed_at DESC').all();
      return comics.map(c => {
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
      });
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
  };
}
