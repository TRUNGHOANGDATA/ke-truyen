import express from 'express';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, IMAGE_HOSTS, refererFor } from './config.js';
import { requireAuth, mountAuth } from './routes/auth.js';
import { createImageCache } from './cache/imageCache.js';
import { mountImageProxy, packImg } from './routes/image.js';
import { openDb } from './db/index.js';
import { createSchema } from './db/migrations.js';
import { withCache } from './source/cached.js';
import { createSettings } from './services/settings.js';
import { createSourceManager } from './services/source-manager.js';
import { createImageHosts } from './services/image-hosts.js';
import { createSiteProber } from './services/site-prober.js';
import { createKvCache } from './services/kv-cache.js';
import { createAltSources } from './services/alt-sources.js';
import { createImageDoctor } from './services/image-doctor.js';
import { createTruyenfullSource } from './source/truyenfull.js';
import { createLibrary } from './services/library.js';
import { createUpdates } from './services/updates.js';
import { createDrive } from './storage/drive.js';
import { createArchive } from './services/archive.js';
import { mountApi } from './routes/api.js';
import { mountPages } from './routes/pages.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildApp(deps = {}) {
  const passwordHash = deps.passwordHash ?? config.PASSWORD_HASH;
  const sessionSecret = deps.sessionSecret ?? config.SESSION_SECRET;
  const cacheDir = deps.cacheDir ?? config.CACHE_DIR;

  const app = express();
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', join(__dirname, 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieSession({
    name: 'sess',
    secret: sessionSecret,
    maxAge: 365 * 24 * 60 * 60 * 1000, // remember long-term
    sameSite: 'lax',
    httpOnly: true,
  }));

  // Helper img(url) -> /img?i=... định nghĩa sau khi có imageHosts (bên dưới),
  // để mỗi link ảnh web dựng ra tự "dạy" proxy host đó là hợp lệ.

  app.use('/public', express.static(join(__dirname, 'public')));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  // Service worker phải phục vụ từ GỐC để có phạm vi "/" (điều khiển cả trang đọc
  // -> đọc offline). Không qua auth để trình duyệt tải/cập nhật được kịch bản.
  app.get('/sw.js', (req, res) => {
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Service-Worker-Allowed', '/');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(join(__dirname, 'public', 'sw.js'));
  });

  mountAuth(app, { passwordHash });

  // everything below requires auth
  app.use(requireAuth);

  const db = deps.db ?? (() => { const d = openDb(config.DB_PATH); createSchema(d); return d; })();

  // Cấu hình sửa được trong web (nguồn + domain), nạp mặc định từ .env lần đầu.
  const settings = createSettings(db);
  settings.seedDefaults({ source: config.SOURCE, truyenqq_base: config.TRUYENQQ_BASE });

  // Host ảnh được phép qua proxy: tĩnh + tự học khi web dựng link ảnh.
  const imageHosts = createImageHosts(settings, IMAGE_HOSTS);
  app.locals.img = (url) => { if (url) imageHosts.learn(url); return url ? `/img?i=${packImg(url)}` : ''; };
  app.locals.imgProxy = app.locals.img;

  // Nguồn động: đổi nguồn/domain lúc chạy không cần restart. Test vẫn inject deps.source được.
  const manager = deps.manager ?? createSourceManager({ db, settings, config, probeFetch: deps.probeFetch });
  const source = deps.source ?? manager.source;
  // Nguồn truyện chữ (Phase 2) — trục riêng, không trộn vào facade truyện tranh.
  // Bọc cache home/list/byCategory/categories như nguồn tranh (detail/chapter/search vẫn tươi).
  const novelSource = deps.novelSource ?? withCache(db, createTruyenfullSource({ base: config.TRUYENFULL_BASE }), { keyPrefix: 'nv:', detailTtlMs: 60 * 60 * 1000, chapterTtlMs: 7 * 24 * 60 * 60 * 1000, searchTtlMs: 10 * 60 * 1000 });
  const library = createLibrary(db);
  const updates = createUpdates({ library, source });

  const drive = deps.drive ?? createDrive({
    clientId: config.DRIVE_CLIENT_ID,
    clientSecret: config.DRIVE_CLIENT_SECRET,
    refreshToken: config.DRIVE_REFRESH_TOKEN,
    rootFolderId: config.DRIVE_FOLDER_ID,
  });
  const archive = createArchive({ db, drive, source, fetchFn: deps.imageFetchFn ?? fetch });

  // Referer dự phòng = base của MỌI nguồn đang đăng ký. CDN ảnh của các nguồn
  // đều chống hotlink theo đúng trang của họ, nên khi nguồn đổi host ảnh (hoặc
  // khi thêm nguồn mới) thì ảnh vẫn lấy được, không cần sửa code.
  const altReferer = () => {
    const qq = (settings.get('truyenqq_base', config.TRUYENQQ_BASE) || config.TRUYENQQ_BASE || '').replace(/\/+$/, '');
    const bases = (manager.comicSources?.() || [])
      .map(s => { try { return s.src.getBase?.(); } catch { return ''; } })
      .filter(Boolean).map(b => String(b).replace(/\/+$/, ''));
    return [...new Set([qq, ...bases])].filter(Boolean).map(b => b + '/');
  };

  const cache = createImageCache({ dir: cacheDir, maxBytes: 2 * 1024 * 1024 * 1024 });
  mountImageProxy(app, {
    fetchFn: deps.imageFetchFn ?? fetch,
    cache,
    isAllowed: (u) => imageHosts.allowed(u),
    refererFor,
    altReferer,
    // Nhớ referer nào lấy được ảnh cho từng host CDN -> lần sau đi thẳng.
    refererHints: { get: (u) => imageHosts.knownReferer(u), set: (u, r) => imageHosts.rememberReferer(u, r) },
    archive,
    drive,
  });

  const kv = createKvCache(db, { prefix: 'kv:' });
  // "Bộ này đọc được ở nguồn nào" — trang đọc dựng sẵn nút từ cache, /api tra khi cần.
  const altSources = deps.altSources ?? createAltSources({ manager, kv });
  mountApi(app, { source, novelSource, library, updates, cacheDir, archive, drive, refererFor, altSources });
  // Dò nguồn TỪ MÁY CHỦ (máy ở nhà hay bị nhà mạng chặn nên dò ở đó không tin được).
  const prober = deps.prober ?? createSiteProber();
  // Chẩn đoán "vì sao ảnh vỡ" từ máy chủ — hết phải sửa mò.
  const imageDoctor = deps.imageDoctor
    ?? createImageDoctor({ source, imageHosts, refererFor, altReferer, fetchFn: deps.imageFetchFn ?? fetch });
  app.locals.services = { db, source, novelSource, library, updates, archive, drive, settings, manager, prober, altSources, imageDoctor };

  // Link chi tiết theo loại: slug truyện chữ mang tiền tố "tf~" -> /chu/...
  app.locals.detailUrl = (slug) => (String(slug).startsWith('tf~') ? '/chu/' + slug.slice(3) : '/truyen/' + slug);
  mountPages(app);

  return app;
}
