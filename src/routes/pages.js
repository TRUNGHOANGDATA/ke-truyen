export function relTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, (Date.now() - then) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)} phút`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ`;
  if (s < 2592000) return `${Math.floor(s / 86400)} ngày`;
  if (s < 31536000) return `${Math.floor(s / 2592000)} tháng`;
  return `${Math.floor(s / 31536000)} năm`;
}

export function mountPages(app) {
  const svc = () => app.locals.services;

  app.get('/', (req, res) => {
    const items = svc().library.listFollowed().map(c => ({
      ...c, thumbUrl: c.thumb_url, when: relTime(c.updated_at_source),
      latestChapter: c.last_chapter_seen,
    }));
    const reading = items.filter(c => c.progress);
    res.render('home', { title: 'Kệ Truyện', active: 'home', items, reading, search: false, browse: false });
  });

  app.get('/following', (req, res) => res.redirect('/'));

  app.get('/browse', (req, res) => res.render('home', {
    title: 'Duyệt truyện', active: 'browse', items: [], reading: [], browse: true, search: false,
  }));

  app.get('/search', (req, res) => res.render('home', {
    title: 'Tìm truyện', active: '', items: [], reading: [], search: true, browse: false,
  }));

  app.get('/status', (req, res) => res.render('status', { title: 'Tình trạng', active: 'status' }));

  app.get('/settings', (req, res) => res.render('settings', { title: 'Cài đặt', active: '' }));

  app.get('/truyen/:slug', async (req, res) => {
    try {
      const detail = await svc().source.detail(req.params.slug);
      const followed = svc().library.isFollowed(detail.slug);
      const progress = svc().library.getProgress(detail.slug);
      res.render('detail', { title: detail.name, active: '', detail, followed, progress });
    } catch (e) {
      res.status(502).render('status', { title: 'Lỗi', active: '' });
    }
  });

  app.get('/doc/:slug/:chapter', async (req, res) => {
    const { slug } = req.params;
    const chapterName = decodeURIComponent(req.params.chapter);
    const svcs = svc();
    try {
      let chapters = svcs.library.chaptersOf(slug);
      let detail = null;
      if (!chapters.length) {
        detail = await svcs.source.detail(slug);
        chapters = detail.chapters.map((c, i) => ({ comic_slug: slug, chapter_name: c.name,
          chapter_title: c.title, api_url: c.apiUrl, order_index: i }));
      }
      const idx = chapters.findIndex(c => c.chapter_name === chapterName);
      if (idx === -1) return res.status(404).send('Không tìm thấy chương');
      const cur = chapters[idx];
      const { images } = await svcs.source.chapter(cur.api_url);
      const prev = idx > 0 ? chapters[idx - 1].chapter_name : null;
      const next = idx < chapters.length - 1 ? chapters[idx + 1].chapter_name : null;
      const progress = svcs.library.getProgress(slug);
      const startPage = (progress && progress.chapterName === chapterName) ? progress.imagePage : 0;
      const name = detail ? detail.name : (svcs.library.listFollowed().find(c => c.slug === slug)?.name || slug);
      res.render('reader', {
        title: `${name} — Chương ${chapterName}`,
        slug, name, chapterName, images, prev, next, startPage,
        total: chapters.length, index: idx,
      });
    } catch (e) {
      res.status(502).send('Lỗi tải chương: ' + (e.message || e));
    }
  });
}
