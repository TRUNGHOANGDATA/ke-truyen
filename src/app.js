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
import { createSource } from './source/otruyen.js';
import { createTruyenQQSource } from './source/truyenqq.js';
import { withCache } from './source/cached.js';
import { createLibrary } from './services/library.js';
import { createUpdates } from './services/updates.js';
import { mountApi } from './routes/api.js';
import { mountPages } from './routes/pages.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Chọn nguồn truyện theo config.SOURCE */
function buildSource() {
  if (config.SOURCE === 'otruyen') {
    return createSource({ base: config.OTRUYEN_BASE, cdnBase: config.CDN_IMAGE_BASE });
  }
  return createTruyenQQSource({ base: config.TRUYENQQ_BASE });
}

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

  // Helper cho template: img(url) -> /img?i=... (không lộ host CDN của nguồn)
  // imgProxy là alias cho chỗ biến vòng lặp đã chiếm tên `img` (reader.ejs)
  app.locals.img = (url) => (url ? `/img?i=${packImg(url)}` : '');
  app.locals.imgProxy = app.locals.img;

  app.use('/public', express.static(join(__dirname, 'public')));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  mountAuth(app, { passwordHash });

  // everything below requires auth
  app.use(requireAuth);

  const cache = createImageCache({ dir: cacheDir, maxBytes: 2 * 1024 * 1024 * 1024 });
  mountImageProxy(app, {
    fetchFn: deps.imageFetchFn ?? fetch,
    cache,
    allowSuffixes: IMAGE_HOSTS,
    refererFor,
  });

  const db = deps.db ?? (() => { const d = openDb(config.DB_PATH); createSchema(d); return d; })();
  const source = deps.source ?? withCache(db, buildSource());
  const library = createLibrary(db);
  const updates = createUpdates({ library, source });

  mountApi(app, { source, library, updates, cacheDir });
  app.locals.services = { db, source, library, updates };
  mountPages(app);

  return app;
}
