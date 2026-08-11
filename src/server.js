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
