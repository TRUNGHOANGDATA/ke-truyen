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

  // Vài thể loại phổ biến để gợi ý ở trang chủ
  const HOME_GENRES = [
    { slug: 'ngon-tinh', name: 'Ngôn Tình' },
    { slug: 'manhua', name: 'Manhua' },
    { slug: 'xuyen-khong', name: 'Xuyên Không' },
    { slug: 'action', name: 'Action' },
    { slug: 'co-dai', name: 'Cổ Đại' },
  ];

  const mapFollowed = (c) => ({ ...c, thumbUrl: c.thumb_url, latestChapter: c.last_chapter_seen });

  app.get('/', async (req, res) => {
    const items = svc().library.listFollowed().map(mapFollowed);
    const reading = items.filter(c => c.progress);
    const source = svc().source;
    let recent = [], genres = [], suggested = [], featured = [];
    try {
      const [home, ...cats] = await Promise.all([
        source.home().catch(() => ({ items: [] })),
        ...HOME_GENRES.map(g => source.byCategory(g.slug, 1).catch(() => ({ items: [] }))),
      ]);
      recent = (home.items || []).slice(0, 12).map(c => ({ ...c, when: relTime(c.updatedAt) }));
      genres = HOME_GENRES.map((g, i) => ({
        ...g, items: (cats[i]?.items || []).slice(0, 6).map(c => ({ ...c, when: relTime(c.updatedAt) })),
      })).filter(g => g.items.length);

      // Gợi ý: trộn nhiều thể loại (ưu tiên thể loại bạn hay theo dõi), loại bỏ truyện đã theo
      const followedCats = new Set(items.flatMap(c => (c.categories || '').split(', ').filter(Boolean)));
      const followedSlugs = new Set(items.map(c => c.slug));
      const order = HOME_GENRES
        .map((g, i) => ({ i, pref: followedCats.has(g.name) ? 0 : 1 }))
        .sort((a, b) => a.pref - b.pref).map(o => o.i);
      const lists = order.map(i => (cats[i]?.items || []).filter(c => !followedSlugs.has(c.slug)));
      const seenSug = new Set();
      for (let round = 0; suggested.length < 12 && round < 12; round++) {
        for (const l of lists) {
          const c = l[round];
          if (c && !seenSug.has(c.slug)) { seenSug.add(c.slug); suggested.push({ ...c, when: relTime(c.updatedAt) }); }
          if (suggested.length >= 12) break;
        }
      }

      // Banner: ưu tiên truyện đang đọc / đang theo, rồi tới truyện hot mới
      const seen = new Set();
      for (const c of [...items].sort((a, b) => (b.progress ? 1 : 0) - (a.progress ? 1 : 0))) {
        if (featured.length >= 6) break;
        featured.push({ slug: c.slug, name: c.name, thumbUrl: c.thumb_url, latestChapter: c.last_chapter_seen,
          categories: (c.categories || '').split(', ').filter(Boolean), progress: c.progress });
        seen.add(c.slug);
      }
      for (const c of recent) {
        if (featured.length >= 6) break;
        if (seen.has(c.slug)) continue;
        featured.push({ slug: c.slug, name: c.name, thumbUrl: c.thumbUrl, latestChapter: c.latestChapter, categories: c.categories || [] });
        seen.add(c.slug);
      }
    } catch { /* nguồn tạm lỗi — vẫn hiện phần theo dõi */ }
    res.render('home', {
      title: 'Kệ Truyện', active: 'home', items, reading, recent, genres, suggested, featured,
      following: false, categories: [], q: '', search: false, browse: false,
    });
  });

  app.get('/following', (req, res) => {
    const items = svc().library.listFollowed().map(mapFollowed);
    const reading = items.filter(c => c.progress);
    res.render('home', {
      title: 'Đang theo dõi', active: 'following', items, reading, recent: [], genres: [],
      suggested: [], featured: [], following: true, categories: [], q: '', search: false, browse: false,
    });
  });

  app.get('/browse', async (req, res) => {
    let categories = [];
    try { categories = await svc().source.categories(); } catch { /* để trống nếu lỗi */ }
    res.render('home', {
      title: 'Duyệt truyện', active: 'browse', items: [], reading: [], recent: [], genres: [],
      suggested: [], featured: [], following: false, categories, q: '', browse: true, search: false,
    });
  });

  app.get('/search', (req, res) => res.render('home', {
    title: 'Tìm truyện', active: '', items: [], reading: [], recent: [], genres: [],
    suggested: [], featured: [], following: false, categories: [], q: req.query.q || '', search: true, browse: false,
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
