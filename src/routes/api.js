import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { packImg } from './image.js';

function dirSize(dir) {
  try {
    return readdirSync(dir).reduce((a, f) => {
      try { return a + statSync(join(dir, f)).size; } catch { return a; }
    }, 0);
  } catch { return 0; }
}

export function mountApi(app, { source, novelSource, library, updates, cacheDir, archive, drive, refererFor }) {
  app.get('/api/library', (req, res) => res.json({ items: library.listFollowed() }));

  // Danh sách URL ảnh (đã gói qua /img) của một chương — để reader tải trước
  // chương kế tiếp. Đồng thời làm ấm cache chapter phía server.
  app.get('/api/chapter-images', async (req, res) => {
    const slug = String(req.query.slug || '');
    const chap = String(req.query.chapter || '');
    try {
      let chapters = library.chaptersOf(slug);
      if (!chapters.length) {
        const d = await source.detail(slug);
        chapters = d.chapters.map(c => ({ chapter_name: c.name, api_url: c.apiUrl }));
      }
      const cur = chapters.find(c => c.chapter_name === chap);
      if (!cur) return res.json({ images: [] });
      const { images = [] } = await source.chapter(cur.api_url);
      res.json({ images: images.map(im => '/img?i=' + packImg(im.url)) });
    } catch { res.json({ images: [] }); }
  });

  // Một nguồn chậm không được kéo cả ô tìm: quá hạn thì trả rỗng cho nguồn đó.
  const withTimeout = (p, ms) => Promise.race([
    p, new Promise(resolve => setTimeout(() => resolve([]), ms)),
  ]);

  app.get('/api/search', async (req, res) => {
    const q = req.query.q || '';
    try {
      // Gộp: truyện tranh (nguồn chính + kho bổ sung) và truyện chữ. Truyện chữ
      // gắn tiền tố tf~ để thẻ link đúng /chu/ và hiện nhãn "Chữ". Không gộp trùng
      // giữa hai loại: cùng tên có thể vừa là truyện tranh vừa là truyện chữ.
      const [comics, novels] = await Promise.all([
        withTimeout(source.search(q).then(r => r.items || []).catch(() => []), 5000),
        withTimeout((novelSource ? novelSource.search(q).then(r => r.items || []) : Promise.resolve([])).catch(() => []), 5000),
      ]);
      const items = [
        ...comics,
        ...novels.map(n => ({ ...n, slug: 'tf~' + n.slug, kind: 'novel' })),
      ];
      res.json({ items });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.get('/api/browse', async (req, res) => {
    const page = Number(req.query.page || 1);
    try {
      if (req.query.category) {
        if (page === 1) library.recordCategoryHit(req.query.category);   // học thể loại hay xem
        return res.json(await source.byCategory(req.query.category, page));
      }
      return res.json(await source.list(req.query.type || 'truyen-moi', page));
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.get('/api/categories', async (req, res) => {
    try { res.json({ items: await source.categories() }); }
    catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.post('/api/follow', async (req, res) => {
    try {
      const detail = await source.detail(req.body.slug);
      library.follow(detail);
      res.json({ ok: true, followed: true });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  // Theo dõi truyện chữ: slug sạch từ URL /chu/:slug, lưu kèm tiền tố "tf~".
  app.post('/api/novel/follow', async (req, res) => {
    try {
      const clean = String(req.body.slug || '');
      const detail = await novelSource.detail(clean);
      detail.slug = 'tf~' + clean;
      library.follow(detail);
      res.json({ ok: true, followed: true });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.post('/api/unfollow', (req, res) => {
    library.unfollow(req.body.slug);
    res.json({ ok: true });
  });

  app.post('/api/clear-progress', (req, res) => {
    library.clearProgress(req.body.slug);
    res.json({ ok: true });
  });

  app.post('/api/progress', (req, res) => {
    const { slug, chapter, page } = req.body;
    library.setProgress(slug, chapter, Number(page) || 0);
    res.json({ ok: true });
  });

  app.post('/api/check', async (req, res) => {
    try {
      if (req.body.slug) return res.json({ results: [await updates.checkOne(req.body.slug)] });
      res.json({ results: await updates.checkAll() });
    } catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  // ---- Lưu offline lên Google Drive ----
  app.post('/api/archive', (req, res) => {
    if (!drive?.configured) {
      return res.status(400).json({ error: 'Chưa cấu hình Google Drive (xem README)' });
    }
    const { slug } = req.body;
    if (!slug) return res.status(400).json({ error: 'thiếu slug' });
    if (archive.isRunning(slug)) return res.json({ ok: true, already: true, job: archive.job(slug) });
    // chạy nền, không giữ request
    archive.archiveComic(slug, { refererFor }).catch(() => {});
    res.json({ ok: true, started: true });
  });

  app.post('/api/archive/cancel', (req, res) => {
    archive.cancel(req.body.slug);
    res.json({ ok: true });
  });

  app.get('/api/archive/status', (req, res) => {
    const slug = req.query.slug;
    res.json({
      configured: !!drive?.configured,
      job: slug ? archive.job(slug) : null,
      savedChapters: slug ? archive.chaptersSaved(slug) : null,
      stats: archive.stats(),
    });
  });

  app.get('/api/status', async (req, res) => {
    const items = library.listFollowed();
    const out = {
      followedCount: items.length,
      unreadTotal: items.reduce((a, c) => a + (c.unread || 0), 0),
      cacheBytes: cacheDir ? dirSize(cacheDir) : 0,
      lastCheck: null,
      archive: archive ? archive.stats() : null,
      drive: { configured: !!drive?.configured, used: null, total: null },
    };
    if (drive?.configured) {
      try { Object.assign(out.drive, await drive.quota()); } catch { /* bỏ qua nếu Drive lỗi */ }
    }
    res.json(out);
  });
}
