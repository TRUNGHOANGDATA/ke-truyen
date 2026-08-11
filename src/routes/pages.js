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

  // Thể loại hiện ở trang chủ, khai báo theo TÊN rồi tự map sang slug của nguồn
  // đang dùng (TruyenQQ dùng slug kèm id như "action-26", OTruyen dùng "action").
  // 'as' = nhãn hiển thị nếu muốn khác tên gốc.
  const HOME_GENRES = [
    { name: 'Huyền Huyễn', as: 'Huyền Huyễn · Tu tiên' },
    { name: 'Manhua' },
    { name: 'Manhwa' },
    { name: 'Xuyên Không' },
    { name: 'Trọng Sinh' },
    { name: 'Chuyển Sinh' },
    { name: 'Martial Arts', as: 'Võ Thuật' },
    { name: 'Ngôn Tình' },
    { name: 'Manga' },
    { name: 'Webtoon' },
    { name: 'Action' },
    { name: 'Cổ Đại' },
    { name: 'Truyện Màu' },
  ];

  /** Map tên thể loại -> slug của nguồn đang dùng */
  async function resolveGenres(source) {
    let cats = [];
    try { cats = await source.categories(); } catch { return []; }
    const bySlug = new Map(cats.map(c => [c.name.trim().toLowerCase(), c.slug]));
    return HOME_GENRES
      .map(g => ({ name: g.as || g.name, slug: bySlug.get(g.name.toLowerCase()) }))
      .filter(g => g.slug);
  }

  const PER_RAIL = 18; // ≥ 15 truyện mỗi thể loại

  // Gọi nguồn theo lô để không bắn hơn 4 request cùng lúc
  async function inBatches(tasks, size = 4) {
    const out = [];
    for (let i = 0; i < tasks.length; i += size) {
      out.push(...await Promise.all(tasks.slice(i, i + size).map(t => t())));
    }
    return out;
  }

  const chapNum = (c) => { const n = parseFloat(c?.latestChapter); return Number.isFinite(n) ? n : 0; };

  const mapFollowed = (c) => ({ ...c, thumbUrl: c.thumb_url, latestChapter: c.last_chapter_seen });

  app.get('/', async (req, res) => {
    const items = svc().library.listFollowed().map(mapFollowed);
    // "Đang đọc dở" độc lập với việc có theo dõi hay không
    const reading = svc().library.listReading().map(mapFollowed);
    const source = svc().source;
    let recent = [], genres = [], suggested = [], featured = [], whyGenres = [];
    try {
      const rails = await resolveGenres(source);
      const [home, ...cats] = await inBatches([
        () => source.home().catch(() => ({ items: [] })),
        ...rails.map(g => () => source.byCategory(g.slug, 1).catch(() => ({ items: [] }))),
      ]);
      recent = (home.items || []).slice(0, 18).map(c => ({ ...c, when: relTime(c.updatedAt) }));
      genres = rails.map((g, i) => ({
        ...g, items: (cats[i]?.items || []).slice(0, PER_RAIL).map(c => ({ ...c, when: relTime(c.updatedAt) })),
      })).filter(g => g.items.length);

      // ---- Gợi ý dựa trên THỂ LOẠI BẠN ĐỌC ----
      // Chấm điểm thể loại: truyện đang đọc dở nặng hơn truyện chỉ theo dõi.
      const taste = new Map();
      const mine = new Map([...items, ...reading].map(c => [c.slug, c]));
      for (const c of mine.values()) {
        const weight = c.progress ? 3 : 1;
        for (const g of (c.categories || '').split(', ').filter(Boolean)) {
          taste.set(g, (taste.get(g) || 0) + weight);
        }
      }
      const topTaste = [...taste.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      whyGenres = topTaste.slice(0, 3).map(([g]) => g);

      const followedSlugs = new Set(mine.keys());
      const candidates = new Map();
      for (const lst of cats) {
        for (const c of (lst?.items || [])) {
          if (followedSlugs.has(c.slug) || candidates.has(c.slug)) continue;
          candidates.set(c.slug, c);
        }
      }
      const scoreOf = (c) => (c.categories || []).reduce((s, g) => s + (taste.get(g) || 0), 0);
      const ranked = [...candidates.values()]
        .map(c => ({ c, s: scoreOf(c) }))
        .sort((a, b) => b.s - a.s || chapNum(b.c) - chapNum(a.c));
      // Nếu chưa theo dõi gì (chưa có "khẩu vị") thì gợi ý theo bộ dài kỳ đang cập nhật
      suggested = ranked.slice(0, 12).map(({ c }) => ({ ...c, when: relTime(c.updatedAt) }));

      // Banner: truyện ĐANG HOT. Nguồn không trả lượt xem, nên xếp hot theo
      // "bộ dài kỳ mà vẫn ra chương đều" = số chương lớn + vừa cập nhật.
      const pool = new Map();
      for (const c of (home.items || [])) pool.set(c.slug, c);
      for (const lst of cats) for (const c of (lst?.items || [])) if (!pool.has(c.slug)) pool.set(c.slug, c);
      const progressBySlug = new Map(items.filter(c => c.progress).map(c => [c.slug, c.progress]));
      featured = [...pool.values()]
        .filter(c => chapNum(c) > 0)
        .sort((a, b) => chapNum(b) - chapNum(a))
        .slice(0, 8)
        .map(c => ({
          slug: c.slug, name: c.name, thumbUrl: c.thumbUrl,
          latestChapter: c.latestChapter, categories: c.categories || [],
          progress: progressBySlug.get(c.slug) || null,
        }));
    } catch { /* nguồn tạm lỗi — vẫn hiện phần theo dõi */ }
    res.render('home', {
      title: 'Kệ Truyện', active: 'home', items, reading, recent, genres, suggested, featured, whyGenres,
      following: false, categories: [], q: '', search: false, browse: false,
    });
  });

  app.get('/following', (req, res) => {
    const items = svc().library.listFollowed().map(mapFollowed);
    const reading = items.filter(c => c.progress);
    res.render('home', {
      title: 'Đang theo dõi', active: 'following', items, reading, recent: [], genres: [],
      suggested: [], featured: [], whyGenres: [], following: true, categories: [], q: '', search: false, browse: false,
    });
  });

  app.get('/browse', async (req, res) => {
    let categories = [];
    try { categories = await svc().source.categories(); } catch { /* để trống nếu lỗi */ }
    res.render('home', {
      title: 'Duyệt truyện', active: 'browse', items: [], reading: [], recent: [], genres: [],
      suggested: [], featured: [], whyGenres: [], following: false, categories, q: '', browse: true, search: false,
    });
  });

  app.get('/search', (req, res) => res.render('home', {
    title: 'Tìm truyện', active: '', items: [], reading: [], recent: [], genres: [],
    suggested: [], featured: [], whyGenres: [], following: false, categories: [], q: req.query.q || '', search: true, browse: false,
  }));

  app.get('/status', (req, res) => res.render('status', { title: 'Tình trạng', active: 'status' }));

  app.get('/settings', (req, res) => res.render('settings', { title: 'Cài đặt', active: '' }));

  app.get('/truyen/:slug', async (req, res) => {
    try {
      const detail = await svc().source.detail(req.params.slug);
      const followed = svc().library.isFollowed(detail.slug);
      const progress = svc().library.getProgress(detail.slug);
      res.render('detail', {
        title: detail.name, active: '', detail, followed, progress,
        updated: relTime(detail.updatedAt),
      });
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
      // Thông tin truyện cho dải thể loại trong trang đọc: lấy từ DB nếu đang
      // theo dõi, không thì từ detail vừa tải (chỉ tải khi chưa có mục lục).
      const row = svcs.library.listTracked().find(c => c.slug === slug);
      if (!detail && !row) detail = await svcs.source.detail(slug);
      // Ghi truyện vào thư viện (followed=0 nếu chưa theo dõi) để vị trí đọc
      // còn hiện lại được ở mục "Đang đọc dở".
      if (detail) svcs.library.remember(detail);
      const name = detail?.name || row?.name || slug;
      const categories = detail
        ? detail.categories
        : (row?.categories || '').split(', ').filter(Boolean);
      res.render('reader', {
        title: `${name} — Chương ${chapterName}`,
        slug, name, chapterName, images, prev, next, startPage,
        total: chapters.length, index: idx,
        categories, author: detail?.author || '', status: detail?.status || row?.status || '',
      });
    } catch (e) {
      res.status(502).send('Lỗi tải chương: ' + (e.message || e));
    }
  });
}
