/**
 * Lưu ảnh chương lên Google Drive để đọc được lâu dài (kể cả khi nguồn chết).
 *
 * Chạy nền từng truyện một, có thể dừng và chạy lại: ảnh nào đã lưu thì bỏ qua,
 * nên bấm lại là tiếp tục chỗ dở chứ không tải lại từ đầu.
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createArchive({ db, drive, source, fetchFn = fetch, politeDelayMs = 250 }) {
  const IMG_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

  const getArchived = db.prepare('SELECT drive_id, bytes FROM archive WHERE src_url=?');
  const putArchived = db.prepare(`
    INSERT INTO archive (src_url, comic_slug, chapter_name, image_page, drive_id, bytes, created_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(src_url) DO UPDATE SET drive_id=excluded.drive_id, bytes=excluded.bytes
  `);
  const upsertJob = db.prepare(`
    INSERT INTO archive_jobs (comic_slug, state, done_chapters, total_chapters, bytes, message, updated_at)
    VALUES (@slug, @state, @done, @total, @bytes, @message, @at)
    ON CONFLICT(comic_slug) DO UPDATE SET
      state=excluded.state, done_chapters=excluded.done_chapters,
      total_chapters=excluded.total_chapters, bytes=excluded.bytes,
      message=excluded.message, updated_at=excluded.updated_at
  `);

  const cancelled = new Set();
  const running = new Set();

  const setJob = (slug, patch) => upsertJob.run({
    slug, state: 'running', done: 0, total: 0, bytes: 0, message: null,
    at: Date.now(), ...patch,
  });

  const jobOf = (slug) => db.prepare('SELECT * FROM archive_jobs WHERE comic_slug=?').get(slug) || null;

  /** Ảnh của một URL đã nằm trên Drive chưa */
  const lookup = (srcUrl) => getArchived.get(srcUrl) || null;

  async function fetchImage(url) {
    const res = await fetchFn(url, {
      headers: { 'User-Agent': IMG_UA, Referer: new URL(url).origin + '/', Accept: 'image/*,*/*;q=0.8' },
    });
    if (!res.ok) throw new Error(`tải ảnh lỗi ${res.status}`);
    return {
      buf: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'image/jpeg',
    };
  }

  /** Lưu một chương; trả số byte đã thêm mới */
  async function archiveChapter(slug, chapter, refererFor) {
    const { images } = await source.chapter(chapter.api_url ?? chapter.apiUrl);
    const folder = await drive.ensureFolder(`truyen/${slug}/${chapter.chapter_name ?? chapter.name}`);
    let added = 0;
    for (const img of images) {
      if (cancelled.has(slug)) break;
      if (lookup(img.url)) continue;                      // đã lưu rồi
      const ref = refererFor ? refererFor(img.url) : undefined;
      const res = await fetchFn(img.url, {
        headers: { 'User-Agent': IMG_UA, ...(ref ? { Referer: ref } : {}), Accept: 'image/*,*/*;q=0.8' },
      });
      if (!res.ok) throw new Error(`tải ảnh lỗi ${res.status} (trang ${img.page + 1})`);
      const contentType = res.headers.get('content-type') || 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = (contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg').split(';')[0];
      const name = `${String(img.page).padStart(3, '0')}.${ext}`;
      const up = await drive.upload({ name, parentId: folder, buffer: buf, mimeType: contentType });
      putArchived.run(img.url, slug, chapter.chapter_name ?? chapter.name, img.page, up.id, up.size, Date.now());
      added += up.size;
      await sleep(politeDelayMs);
    }
    return added;
  }

  /** Lưu cả truyện, chạy nền. Gọi lại khi đang chạy thì bỏ qua. */
  async function archiveComic(slug, { chapters, refererFor } = {}) {
    if (running.has(slug)) return jobOf(slug);
    running.add(slug);
    cancelled.delete(slug);

    const list = chapters || db.prepare(
      'SELECT * FROM chapters WHERE comic_slug=? ORDER BY order_index'
    ).all(slug);

    setJob(slug, { state: 'running', total: list.length, done: 0, bytes: 0 });
    let bytes = 0, done = 0;
    try {
      for (const ch of list) {
        if (cancelled.has(slug)) {
          setJob(slug, { state: 'cancelled', total: list.length, done, bytes });
          return jobOf(slug);
        }
        bytes += await archiveChapter(slug, ch, refererFor);
        done++;
        setJob(slug, { state: 'running', total: list.length, done, bytes });
      }
      setJob(slug, { state: 'done', total: list.length, done, bytes });
    } catch (err) {
      setJob(slug, { state: 'error', total: list.length, done, bytes, message: String(err.message || err) });
    } finally {
      running.delete(slug);
    }
    return jobOf(slug);
  }

  return {
    lookup,
    archiveChapter,
    archiveComic,
    cancel(slug) { cancelled.add(slug); },
    job: jobOf,
    isRunning: (slug) => running.has(slug),
    /** Tổng dung lượng đã lưu + số ảnh */
    stats() {
      const r = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(bytes),0) b FROM archive').get();
      const comics = db.prepare('SELECT COUNT(DISTINCT comic_slug) n FROM archive').get().n;
      return { images: r.n, bytes: r.b, comics };
    },
    /** Số chương đã lưu của một truyện */
    chaptersSaved(slug) {
      return db.prepare('SELECT COUNT(DISTINCT chapter_name) n FROM archive WHERE comic_slug=?').get(slug).n;
    },
  };
}
