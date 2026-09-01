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

// Dọn bộ MỒ CÔI: slug mang tiền tố của kho đã gỡ (vd ot~ sau khi bỏ nettruyen.id
// vì CDN chết) thì không nguồn nào đọc được nữa -> xoá khỏi thư viện cho gọn.
// Chỉ xoá cái không thuộc kho nào còn khai báo, nên an toàn chạy mỗi lần khởi động.
try {
  const kept = [...(config.NETTRUYEN_SITES || []).map(s => s.prefix), 'tf~'];
  const n = app.locals.services?.library?.purgeOrphans?.(kept) || 0;
  if (n) console.log(`[don] go ${n} bo mo coi (nguon da bo)`);
} catch (e) { console.error('[don] loi', e); }

// Làm ấm cache trang chủ: ngay sau khi khởi động (cache trống) + định kỳ 20'
// (dưới TTL 30' của cache thể loại) để người dùng luôn gặp bản ấm, không phải
// chờ lần tải nguội ~9s+ (nặng vì nhiều dải thể loại + kho bổ sung qua CDN chậm).
const WARM_MS = 20 * 60 * 1000;
const warm = () => Promise.resolve(app.locals.warmHome?.()).catch(() => {});
// Làm ấm SỚM + thử lại vài nhịp đầu: lúc pod vừa lên nguồn có thể chưa sẵn, mà
// cache lại vừa trống (mỗi lần deploy) -> người vào đầu tiên dễ ăn ~15s tải nguội.
// Nhờ stale-while-revalidate, chỉ cần ấm THÀNH CÔNG một lần là các lần sau luôn
// có bản cũ trả ngay. Warm lặp lại thì cache hit nên rất nhẹ.
[800, 8000, 25000, 60000].forEach(ms => setTimeout(warm, ms));
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
