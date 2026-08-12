/**
 * Lưu ảnh chương lên Google Drive để đọc được lâu dài (kể cả khi nguồn chết).
 *
 * Chạy nền từng truyện một, có thể dừng và chạy lại: ảnh nào đã lưu thì bỏ qua,
 * nên bấm lại là tiếp tục chỗ dở chứ không tải lại từ đầu.
 */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createArchive({ db, drive, source, fetchFn = fetch, politeDelayMs = 250, imgRetryDelayMs = 600 }) {
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

  /** Tải một ảnh, thử lại vài lần (CDN thỉnh thoảng chặn hotlink 403/429) */
  async function fetchImageOnce(url, refererFor, tries = 3) {
    const ref = refererFor ? refererFor(url) : undefined;
    let last;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetchFn(url, {
          headers: { 'User-Agent': IMG_UA, ...(ref ? { Referer: ref } : {}), Accept: 'image/*,*/*;q=0.8' },
          signal: AbortSignal.timeout(30000),
        });
        if (res.ok) {
          const contentType = res.headers.get('content-type') || 'image/jpeg';
          return { buf: Buffer.from(await res.arrayBuffer()), contentType };
        }
        last = new Error(`HTTP ${res.status}`);
      } catch (e) { last = e; }
      await sleep(imgRetryDelayMs * (i + 1));
    }
    throw last;
  }

  /**
   * Lưu một chương; gọi onImage(byteVừaThêm) sau mỗi ảnh.
   * Ảnh nào tải mãi không được thì BỎ QUA (ghi vào skipped) chứ không giết cả truyện.
   * @returns {{ added:number, skipped:number }}
   */
  async function archiveChapter(slug, chapter, refererFor, onImage = () => {}) {
    const chapName = chapter.chapter_name ?? chapter.name;
    const { images } = await source.chapter(chapter.api_url ?? chapter.apiUrl);
    const folder = await drive.ensureFolder(`truyen/${slug}/${chapName}`);
    let added = 0, skipped = 0;
    for (const img of images) {
      if (cancelled.has(slug)) break;
      if (lookup(img.url)) continue;                      // đã lưu rồi
      let dl;
      try {
        dl = await fetchImageOnce(img.url, refererFor);
      } catch {
        skipped++;                                        // bỏ qua ảnh lỗi, đi tiếp
        continue;
      }
      const ext = (dl.contentType.split('/')[1] || 'jpg').replace('jpeg', 'jpg').split(';')[0];
      const name = `${String(img.page).padStart(3, '0')}.${ext}`;
      const up = await drive.upload({ name, parentId: folder, buffer: dl.buf, mimeType: dl.contentType });
      putArchived.run(img.url, slug, chapName, img.page, up.id, up.size, Date.now());
      added += up.size;
      onImage(up.size);
      await sleep(politeDelayMs);
    }
    return { added, skipped };
  }

  /** Lưu cả truyện, chạy nền. Gọi lại khi đang chạy thì bỏ qua. */
  async function archiveComic(slug, { chapters, refererFor } = {}) {
    if (running.has(slug)) return jobOf(slug);
    running.add(slug);
    cancelled.delete(slug);

    let list = chapters || db.prepare(
      'SELECT * FROM chapters WHERE comic_slug=? ORDER BY order_index'
    ).all(slug);
    // Chưa mở/theo dõi truyện này thì DB chưa có mục lục -> lấy từ nguồn
    if (!list.length) {
      try {
        const detail = await source.detail(slug);
        list = detail.chapters.map((c, i) => ({
          comic_slug: slug, chapter_name: c.name, api_url: c.apiUrl, order_index: i,
        }));
      } catch (err) {
        setJob(slug, { state: 'error', total: 0, done: 0, bytes: 0, message: 'Không tải được mục lục: ' + (err.message || err) });
        running.delete(slug);
        return jobOf(slug);
      }
    }

    setJob(slug, { state: 'running', total: list.length, done: 0, bytes: 0 });
    let bytes = 0, done = 0, skipped = 0;
    try {
      for (const ch of list) {
        if (cancelled.has(slug)) {
          setJob(slug, { state: 'cancelled', total: list.length, done, bytes });
          return jobOf(slug);
        }
        // cập nhật bytes ngay sau mỗi ảnh cho thanh tiến trình nhích đều
        let lastTick = 0;
        const r = await archiveChapter(slug, ch, refererFor, (b) => {
          bytes += b;
          const now = Date.now();
          if (now - lastTick > 500) { lastTick = now; setJob(slug, { state: 'running', total: list.length, done, bytes }); }
        });
        skipped += r.skipped;
        done++;
        setJob(slug, { state: 'running', total: list.length, done, bytes });
      }
      const msg = skipped ? `Đã lưu xong, ${skipped} ảnh lỗi bị bỏ qua (bấm Lưu lại để thử tải nốt).` : null;
      setJob(slug, { state: 'done', total: list.length, done, bytes, message: msg });
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
