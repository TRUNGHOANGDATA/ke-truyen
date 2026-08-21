import { buildApp } from './app.js';
import { config } from './config.js';
import { openDb } from './db/index.js';
import { createSchema } from './db/migrations.js';
import { createImageCache } from './cache/imageCache.js';
import { copyFileSync, mkdirSync } from 'node:fs';

const db = openDb(config.DB_PATH);
createSchema(db);

const app = buildApp({ db });
app.listen(config.PORT, () => console.log(`listening on :${config.PORT}`));

// Làm ấm cache trang chủ: ngay sau khi khởi động (cache trống) + định kỳ 20'
// (dưới TTL 30' của cache thể loại) để người dùng luôn gặp bản ấm, không phải
// chờ lần tải nguội ~9s+ (nặng vì nhiều dải thể loại + kho bổ sung qua CDN chậm).
const WARM_MS = 20 * 60 * 1000;
const warm = () => Promise.resolve(app.locals.warmHome?.()).catch(() => {});
setTimeout(warm, 3000);
setInterval(warm, WARM_MS);

// nightly maintenance: backup DB + prune cache. Keeps the Always-Free VPS non-idle.
// This does NOT call the OTruyen source, so it complies with "no background source polling".
const DAY = 24 * 60 * 60 * 1000;
setInterval(() => {
  try {
    mkdirSync('./data/backups', { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    copyFileSync(config.DB_PATH, `./data/backups/app-${stamp}.db`);
    createImageCache({ dir: config.CACHE_DIR }).prune();
    console.log('[maintenance] backup + prune done');
  } catch (e) { console.error('[maintenance] failed', e); }
}, DAY);
