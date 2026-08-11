# Web Đọc Truyện Tranh — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private, ad-free comic (truyện tranh) reader that pulls content from the OTruyen API, accessible from iPhone and desktop, deployable free on an Oracle Always Free VPS.

**Architecture:** A single Node.js/Express process serves server-rendered EJS pages plus a small JSON API. Comic metadata comes live from the OTruyen API (wrapped in one swappable `ComicSource` module); chapter images are streamed through an authenticated image proxy that caches to local disk. A `better-sqlite3` database holds followed comics, reading progress, settings, and the single-user password hash. No background scheduler — the source is only queried when the user acts. The whole app runs in Docker behind Caddy (automatic HTTPS).

**Tech Stack:** Node.js 20 LTS · Express · EJS templates · better-sqlite3 · bcrypt · cookie-session · native `fetch` · vanilla JS frontend (no build step) · node:test + supertest · Docker Compose + Caddy.

## Global Constraints

- **Cost: 0đ.** No paid services. Oracle **Always Free** account only (never upgrade to Pay-As-You-Go).
- **Node.js 20 LTS.** Use built-in global `fetch` (no `node-fetch` dependency). Use built-in `node:test` runner (no Jest/Mocha).
- **Single process.** Web server, source client, and image proxy run in one Node process. No separate worker, no external DB server, no Redis.
- **No background scheduler.** The OTruyen API is only called in response to a user action (opening a page, pressing "Kiểm tra chương mới", opening a comic). No cron, no `setInterval` polling of the source.
- **Auth gate on everything.** Every route except the login page and static CSS/JS/icons requires an authenticated session — including the `/img` image proxy. Initial password is `E521satan`, stored only as a **bcrypt hash** in `.env` (which is git-ignored). Never store or log the plaintext.
- **UI is fixed.** Follow `docs/superpowers/specs/mockups/manga-ui.html` exactly for layout, colors, and typography. Palette: bg `#EBEBEB`, card `#FFFFFF`, accent/hot `#FF2853`, link `#1568C8`, read/ok `#17A67B`, reader bg `#0B0A0D`. System fonts, no ALL-CAPS (breaks Vietnamese diacritics), monospace for numbers.
- **OTruyen API** base URL: `https://otruyenapi.com/v1/api`. Image CDN for covers: `https://img.otruyenapi.com`. Be polite: max 3 concurrent requests to the source, retry with backoff on failure.
- **Dependency injection for network.** Every module that calls `fetch` accepts a `fetchFn` parameter (defaulting to global `fetch`) so tests run offline against saved fixtures — never hitting the real API in CI.
- **`main` is the working branch.** Commit after every task. Never commit `.env` or `data/`.

## OTruyen API Reference (verified 2026-08-11)

All responses have shape `{ status, message, data }`.

| Purpose | Method + Path | Key response fields |
|---|---|---|
| Home (recent) | `GET /home` | `data.items[]`, `data.APP_DOMAIN_CDN_IMAGE` |
| List by type | `GET /danh-sach/{type}?page=N` | `data.items[]`, `data.params.pagination` (`totalItems`, `totalItemsPerPage`, `currentPage`), `data.APP_DOMAIN_CDN_IMAGE`. type e.g. `truyen-moi` |
| Search | `GET /tim-kiem?keyword={q}` | `data.items[]` |
| Categories | `GET /the-loai` | `data.items[]` (`_id`, `name`, `slug`) — 61 items |
| List by category | `GET /the-loai/{slug}?page=N` | same shape as list-by-type |
| Comic detail | `GET /truyen-tranh/{slug}` | `data.item` + `data.APP_DOMAIN_CDN_IMAGE` |
| Chapter images | `GET {chapter_api_data}` | `data.domain_cdn`, `data.item.chapter_path`, `data.item.chapter_image[]` |

**Comic item** (`data.items[]` and `data.item`): `_id`, `name`, `slug`, `origin_name[]`, `status` (`ongoing`/`completed`/`coming_soon`), `thumb_url` (bare filename), `category[]` (`{id,name,slug}`), `updatedAt` (ISO), `chaptersLatest[]` (list preview), `content` (HTML synopsis, detail only), `chapters[]` (detail only).

**Detail `chapters`:** array of servers `{ server_name, server_data[] }`. Each `server_data` entry: `{ filename, chapter_name, chapter_title, chapter_api_data }` where `chapter_api_data` is a full URL like `https://sv1.otruyencdn.com/v1/api/chapter/{id}`.

**Chapter images response:** `data.domain_cdn` (e.g. `https://sv1.otruyencdn.com`), `data.item.chapter_path` (e.g. `uploads/20240606/abc/chapter_1`), `data.item.chapter_image[]` each `{ image_page: number, image_file: string }` (e.g. `page_0.jpg`).

**URL construction:**
- Cover: `{APP_DOMAIN_CDN_IMAGE}/uploads/comics/{thumb_url}`
- Chapter image: `{domain_cdn}/{chapter_path}/{image_file}`

**Proxy whitelist (host suffixes):** `img.otruyenapi.com`, `otruyencdn.com` (covers `sv1.otruyencdn.com` etc.). Requests to any other host return 403.

## File Structure

```
package.json          deps, scripts, "type":"module"
.gitignore            node_modules, .env, data/, cache/
.env.example          template env vars (no secrets)
src/
  config.js           load+validate env, export constants
  app.js              build & return Express app (no listen) — testable
  server.js           import app, run migrations, app.listen
  db/
    index.js          better-sqlite3 connection (path from config)
    migrations.js     createSchema(db): tables + indexes
  source/
    normalize.js      pure mappers: raw API JSON -> domain objects; URL builders
    otruyen.js        ComicSource: network calls, retry, concurrency limit
  services/
    library.js        follow/unfollow/list, reading progress
    updates.js        checkForNewChapters()
  routes/
    auth.js           requireAuth middleware, login/logout/change-password
    image.js          GET /img proxy + cache integration
    api.js            JSON endpoints for frontend
    pages.js          server-rendered page routes
  cache/
    imageCache.js     disk LRU cache (get/put/prune)
  views/
    layout.ejs partials/header.ejs partials/comic-card.ejs
    login.ejs home.ejs detail.ejs reader.ejs settings.ejs status.ejs
  public/
    css/styles.css    extracted from mockup
    js/home.js js/reader.js js/common.js
    manifest.webmanifest sw.js icons/
tests/
  fixtures/           saved OTruyen JSON responses
  normalize.test.js source.test.js auth.test.js image.test.js
  library.test.js updates.test.js api.test.js
scripts/
  setup-server.sh     one-command VPS provision
  smoke-live.js       manual real-API check (not in CI)
Dockerfile docker-compose.yml Caddyfile
```

---

### Task 1: Project scaffold + config + health check

**Files:**
- Create: `package.json`, `.gitignore`, `.env.example`, `src/config.js`, `src/app.js`, `src/server.js`
- Test: `tests/app.test.js`

**Interfaces:**
- Produces: `buildApp(deps = {})` in `src/app.js` returning an Express app; `config` object in `src/config.js` with `PORT`, `DB_PATH`, `CACHE_DIR`, `SESSION_SECRET`, `PASSWORD_HASH`, `OTRUYEN_BASE`, `CDN_IMAGE_BASE`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "web-truyen",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node --test",
    "smoke": "node scripts/smoke-live.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "ejs": "^3.1.10",
    "better-sqlite3": "^11.3.0",
    "bcryptjs": "^2.4.3",
    "cookie-session": "^2.1.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

Note: use `bcryptjs` (pure JS, no native build headaches on ARM VPS).

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.env
data/
cache/
*.log
```

- [ ] **Step 3: Create `.env.example`**

```
PORT=3000
DB_PATH=./data/app.db
CACHE_DIR=./cache/images
SESSION_SECRET=change-me-to-a-long-random-string
# bcrypt hash of the login password (generate with: node scripts/hash-password.js)
PASSWORD_HASH=
OTRUYEN_BASE=https://otruyenapi.com/v1/api
CDN_IMAGE_BASE=https://img.otruyenapi.com
```

- [ ] **Step 4: Create `src/config.js`**

```js
import 'node:process';

const required = ['SESSION_SECRET'];
for (const k of required) {
  if (!process.env[k]) console.warn(`[config] missing env ${k} — using insecure default`);
}

export const config = {
  PORT: Number(process.env.PORT || 3000),
  DB_PATH: process.env.DB_PATH || './data/app.db',
  CACHE_DIR: process.env.CACHE_DIR || './cache/images',
  SESSION_SECRET: process.env.SESSION_SECRET || 'insecure-dev-secret',
  PASSWORD_HASH: process.env.PASSWORD_HASH || '',
  OTRUYEN_BASE: process.env.OTRUYEN_BASE || 'https://otruyenapi.com/v1/api',
  CDN_IMAGE_BASE: process.env.CDN_IMAGE_BASE || 'https://img.otruyenapi.com',
};
```

- [ ] **Step 5: Create `src/app.js` with a health route**

```js
import express from 'express';

export function buildApp(deps = {}) {
  const app = express();
  app.use(express.json());
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  return app;
}
```

- [ ] **Step 6: Create `src/server.js`**

```js
import { buildApp } from './app.js';
import { config } from './config.js';

const app = buildApp();
app.listen(config.PORT, () => console.log(`listening on :${config.PORT}`));
```

- [ ] **Step 7: Write the failing test `tests/app.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../src/app.js';

test('GET /healthz returns ok', async () => {
  const app = buildApp();
  const res = await request(app).get('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
```

- [ ] **Step 8: Install and run**

Run: `npm install && npm test`
Expected: PASS (health test green).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: project scaffold, config, health check"
```

---

### Task 2: Database layer + schema

**Files:**
- Create: `src/db/index.js`, `src/db/migrations.js`
- Test: `tests/db.test.js`

**Interfaces:**
- Produces: `openDb(path)` returning a better-sqlite3 instance; `createSchema(db)` creating all tables. Tables: `comics`, `chapters`, `reading_progress`, `settings`, `api_cache`.

- [ ] **Step 1: Write the failing test `tests/db.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';

test('createSchema creates all tables', () => {
  const db = openDb(':memory:');
  createSchema(db);
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all().map(r => r.name);
  for (const t of ['comics', 'chapters', 'reading_progress', 'settings', 'api_cache']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test('comics table round-trips a row', () => {
  const db = openDb(':memory:');
  createSchema(db);
  db.prepare(`INSERT INTO comics (slug, name, thumb_url, status, categories, updated_at_source, followed_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run('abc', 'Test', 'abc-thumb.jpg', 'ongoing', 'Action', '2026-01-01T00:00:00Z', Date.now());
  const row = db.prepare('SELECT * FROM comics WHERE slug=?').get('abc');
  assert.equal(row.name, 'Test');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/db.test.js`
Expected: FAIL (`openDb` not defined).

- [ ] **Step 3: Create `src/db/index.js`**

```js
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
```

- [ ] **Step 4: Create `src/db/migrations.js`**

```js
export function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS comics (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      thumb_url TEXT,
      status TEXT,
      categories TEXT,
      last_chapter_seen TEXT,
      updated_at_source TEXT,
      followed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chapters (
      comic_slug TEXT NOT NULL,
      chapter_name TEXT NOT NULL,
      chapter_title TEXT,
      api_url TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (comic_slug, chapter_name)
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      comic_slug TEXT PRIMARY KEY,
      chapter_name TEXT NOT NULL,
      image_page INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS api_cache (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chapters_comic ON chapters(comic_slug, order_index);
  `);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/db.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: sqlite connection and schema"
```

---

### Task 3: Normalize module (pure mappers + URL builders)

**Files:**
- Create: `src/source/normalize.js`
- Test: `tests/normalize.test.js`, `tests/fixtures/detail.json`, `tests/fixtures/chapter.json`

**Interfaces:**
- Produces:
  - `coverUrl(cdnBase, thumbUrl)` → string
  - `mapListItem(raw, cdnBase)` → `{ slug, name, thumbUrl, status, categories: string[], updatedAt, latestChapter }`
  - `mapDetail(raw)` where `raw = data` → `{ slug, name, origin, content, status, thumbUrl, categories, chapters: [{ name, title, apiUrl, order }] }`
  - `mapChapterImages(raw)` where `raw = data` → `{ images: [{ page, url }] }`

- [ ] **Step 1: Create fixtures**

Create `tests/fixtures/detail.json` — a trimmed real detail response. Minimum viable content:

```json
{
  "data": {
    "APP_DOMAIN_CDN_IMAGE": "https://img.otruyenapi.com",
    "item": {
      "name": "Tiên Nghịch",
      "slug": "tien-nghich",
      "origin_name": ["Renegade Immortal"],
      "content": "<p>Vương Lâm...</p>",
      "status": "ongoing",
      "thumb_url": "tien-nghich-thumb.jpg",
      "category": [{ "id": "1", "name": "Action", "slug": "action" }],
      "chapters": [
        { "server_name": "Server #1", "server_data": [
          { "filename": "c1", "chapter_name": "1", "chapter_title": "",
            "chapter_api_data": "https://sv1.otruyencdn.com/v1/api/chapter/aaa" },
          { "filename": "c2", "chapter_name": "2", "chapter_title": "Khởi đầu",
            "chapter_api_data": "https://sv1.otruyencdn.com/v1/api/chapter/bbb" }
        ]}
      ]
    }
  }
}
```

Create `tests/fixtures/chapter.json`:

```json
{
  "data": {
    "domain_cdn": "https://sv1.otruyencdn.com",
    "item": {
      "chapter_path": "uploads/20240606/abc/chapter_1",
      "chapter_image": [
        { "image_page": 0, "image_file": "page_0.jpg" },
        { "image_page": 1, "image_file": "page_1.jpg" }
      ]
    }
  }
}
```

- [ ] **Step 2: Write the failing test `tests/normalize.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coverUrl, mapDetail, mapChapterImages } from '../src/source/normalize.js';

const detail = JSON.parse(readFileSync(new URL('./fixtures/detail.json', import.meta.url)));
const chapter = JSON.parse(readFileSync(new URL('./fixtures/chapter.json', import.meta.url)));

test('coverUrl joins cdn base and thumb', () => {
  assert.equal(
    coverUrl('https://img.otruyenapi.com', 'x.jpg'),
    'https://img.otruyenapi.com/uploads/comics/x.jpg'
  );
});

test('mapDetail flattens chapters in order', () => {
  const d = mapDetail(detail.data);
  assert.equal(d.slug, 'tien-nghich');
  assert.equal(d.categories[0], 'Action');
  assert.equal(d.chapters.length, 2);
  assert.equal(d.chapters[0].name, '1');
  assert.equal(d.chapters[0].order, 0);
  assert.equal(d.chapters[1].apiUrl, 'https://sv1.otruyencdn.com/v1/api/chapter/bbb');
});

test('mapChapterImages builds full image urls', () => {
  const c = mapChapterImages(chapter.data);
  assert.equal(c.images.length, 2);
  assert.equal(c.images[0].url,
    'https://sv1.otruyencdn.com/uploads/20240606/abc/chapter_1/page_0.jpg');
  assert.equal(c.images[0].page, 0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/normalize.test.js`
Expected: FAIL (module not found).

- [ ] **Step 4: Create `src/source/normalize.js`**

```js
export function coverUrl(cdnBase, thumbUrl) {
  if (!thumbUrl) return '';
  return `${cdnBase}/uploads/comics/${thumbUrl}`;
}

export function mapListItem(raw, cdnBase) {
  return {
    slug: raw.slug,
    name: raw.name,
    thumbUrl: coverUrl(cdnBase, raw.thumb_url),
    status: raw.status,
    categories: (raw.category || []).map(c => c.name),
    updatedAt: raw.updatedAt,
    latestChapter: raw.chaptersLatest?.[0]?.chapter_name ?? null,
  };
}

export function mapDetail(data) {
  const item = data.item;
  const servers = item.chapters || [];
  const flat = servers.flatMap(s => s.server_data || []);
  const chapters = flat.map((c, i) => ({
    name: c.chapter_name,
    title: c.chapter_title || '',
    apiUrl: c.chapter_api_data,
    order: i,
  }));
  return {
    slug: item.slug,
    name: item.name,
    origin: (item.origin_name || []).join(' · '),
    content: item.content || '',
    status: item.status,
    thumbUrl: coverUrl(data.APP_DOMAIN_CDN_IMAGE, item.thumb_url),
    categories: (item.category || []).map(c => c.name),
    chapters,
  };
}

export function mapChapterImages(data) {
  const { domain_cdn, item } = data;
  const images = (item.chapter_image || []).map(img => ({
    page: img.image_page,
    url: `${domain_cdn}/${item.chapter_path}/${img.image_file}`,
  }));
  return { images };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/normalize.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: normalize OTruyen responses to domain objects"
```

---

### Task 4: OTruyen source client (network, retry, concurrency)

**Files:**
- Create: `src/source/otruyen.js`
- Test: `tests/source.test.js`

**Interfaces:**
- Consumes: `mapListItem`, `mapDetail`, `mapChapterImages` from `normalize.js`; `config` values `OTRUYEN_BASE`, `CDN_IMAGE_BASE`.
- Produces: `createSource({ base, cdnBase, fetchFn })` returning an object:
  - `home()` → `{ items }`
  - `list(type, page)` → `{ items, pagination }`
  - `search(keyword)` → `{ items }`
  - `categories()` → `[{ name, slug }]`
  - `byCategory(slug, page)` → `{ items, pagination }`
  - `detail(slug)` → domain detail (from `mapDetail`)
  - `chapter(apiUrl)` → `{ images }` (from `mapChapterImages`)

- [ ] **Step 1: Write the failing test `tests/source.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSource } from '../src/source/otruyen.js';

const detail = JSON.parse(readFileSync(new URL('./fixtures/detail.json', import.meta.url)));
const chapter = JSON.parse(readFileSync(new URL('./fixtures/chapter.json', import.meta.url)));

function fakeFetch(map) {
  return async (url) => {
    const key = Object.keys(map).find(k => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => map[key] };
  };
}

test('detail() returns mapped domain object', async () => {
  const src = createSource({
    base: 'https://api.test/v1/api',
    cdnBase: 'https://img.test',
    fetchFn: fakeFetch({ '/truyen-tranh/tien-nghich': detail }),
  });
  const d = await src.detail('tien-nghich');
  assert.equal(d.name, 'Tiên Nghịch');
  assert.equal(d.chapters.length, 2);
});

test('chapter() maps images', async () => {
  const src = createSource({
    base: 'https://api.test/v1/api', cdnBase: 'https://img.test',
    fetchFn: fakeFetch({ '/chapter/bbb': chapter }),
  });
  const c = await src.chapter('https://sv1.otruyencdn.com/v1/api/chapter/bbb');
  assert.equal(c.images.length, 2);
});

test('retries then throws on repeated failure', async () => {
  let calls = 0;
  const src = createSource({
    base: 'https://api.test/v1/api', cdnBase: 'https://img.test',
    fetchFn: async () => { calls++; throw new Error('network'); },
    retries: 2, retryDelayMs: 1,
  });
  await assert.rejects(() => src.home());
  assert.equal(calls, 3); // initial + 2 retries
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/source.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/source/otruyen.js`**

```js
import { mapListItem, mapDetail, mapChapterImages } from './normalize.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createSource({ base, cdnBase, fetchFn = fetch, retries = 2, retryDelayMs = 400 }) {
  async function getJson(url) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchFn(url, { headers: { 'user-agent': 'web-truyen/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const body = await res.json();
        if (body.status && body.status !== 'success') throw new Error(`API status ${body.status}`);
        return body.data;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
      }
    }
    throw lastErr;
  }

  const listShape = (data) => ({
    items: (data.items || []).map(i => mapListItem(i, cdnBase)),
    pagination: data.params?.pagination || null,
  });

  return {
    async home() { return listShape(await getJson(`${base}/home`)); },
    async list(type = 'truyen-moi', page = 1) {
      return listShape(await getJson(`${base}/danh-sach/${type}?page=${page}`));
    },
    async search(keyword) {
      return listShape(await getJson(`${base}/tim-kiem?keyword=${encodeURIComponent(keyword)}`));
    },
    async categories() {
      const data = await getJson(`${base}/the-loai`);
      return (data.items || []).map(c => ({ name: c.name, slug: c.slug }));
    },
    async byCategory(slug, page = 1) {
      return listShape(await getJson(`${base}/the-loai/${slug}?page=${page}`));
    },
    async detail(slug) {
      return mapDetail(await getJson(`${base}/truyen-tranh/${slug}`));
    },
    async chapter(apiUrl) {
      return mapChapterImages(await getJson(apiUrl));
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/source.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: OTruyen source client with retry"
```

---

### Task 5: Authentication (bcrypt, session, guard, login/logout)

**Files:**
- Create: `src/routes/auth.js`, `scripts/hash-password.js`
- Modify: `src/app.js` (wire cookie-session + auth routes + requireAuth)
- Test: `tests/auth.test.js`

**Interfaces:**
- Consumes: `config.SESSION_SECRET`, `config.PASSWORD_HASH`.
- Produces:
  - `requireAuth(req, res, next)` middleware — passes through if `req.session?.authed`, else redirects to `/login` (or 401 for `/api/*` and `/img`).
  - `mountAuth(app, { passwordHash })` — attaches `GET /login`, `POST /login`, `POST /logout`, `POST /settings/password`.
  - `scripts/hash-password.js` prints a bcrypt hash for a password passed as argv.

- [ ] **Step 1: Create `scripts/hash-password.js`**

```js
import bcrypt from 'bcryptjs';
const pw = process.argv[2];
if (!pw) { console.error('usage: node scripts/hash-password.js <password>'); process.exit(1); }
console.log(bcrypt.hashSync(pw, 10));
```

- [ ] **Step 2: Write the failing test `tests/auth.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';

const hash = bcrypt.hashSync('secret123', 10);

function appWith() {
  return buildApp({ passwordHash: hash, sessionSecret: 'test-secret' });
}

test('protected page redirects to /login when unauthenticated', async () => {
  const res = await request(appWith()).get('/').redirects(0);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login');
});

test('api route returns 401 when unauthenticated', async () => {
  const res = await request(appWith()).get('/api/library');
  assert.equal(res.status, 401);
});

test('login with wrong password fails', async () => {
  const res = await request(appWith()).post('/login').type('form').send({ password: 'nope' }).redirects(0);
  assert.equal(res.status, 401);
});

test('login with correct password sets session and allows access', async () => {
  const agent = request.agent(appWith());
  const login = await agent.post('/login').type('form').send({ password: 'secret123' }).redirects(0);
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, '/');
  const home = await agent.get('/healthz');
  assert.equal(home.status, 200);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test tests/auth.test.js`
Expected: FAIL (auth not wired; `/api/library` 404 not 401).

- [ ] **Step 4: Create `src/routes/auth.js`**

```js
import bcrypt from 'bcryptjs';

export function requireAuth(req, res, next) {
  if (req.session?.authed) return next();
  if (req.path.startsWith('/api/') || req.path === '/img') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.redirect('/login');
}

export function mountAuth(app, { passwordHash }) {
  app.get('/login', (req, res) => {
    if (req.session?.authed) return res.redirect('/');
    res.render('login', { error: null });
  });

  app.post('/login', express => {}); // placeholder replaced below
}
```

Then replace the body of `mountAuth` with the full implementation (no placeholder):

```js
export function mountAuth(app, { passwordHash }) {
  app.get('/login', (req, res) => {
    if (req.session?.authed) return res.redirect('/');
    res.render('login', { error: null });
  });

  app.post('/login', (req, res) => {
    const ok = passwordHash && bcrypt.compareSync(req.body.password || '', passwordHash);
    if (!ok) return res.status(401).render('login', { error: 'Sai mật khẩu' });
    req.session.authed = true;
    res.redirect('/');
  });

  app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

  app.post('/settings/password', (req, res) => {
    const { current, next } = req.body;
    if (!bcrypt.compareSync(current || '', passwordHash)) {
      return res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
    }
    if (!next || next.length < 6) return res.status(400).json({ error: 'Mật khẩu mới quá ngắn' });
    const newHash = bcrypt.hashSync(next, 10);
    res.json({ ok: true, hash: newHash, note: 'Cập nhật PASSWORD_HASH trong .env rồi khởi động lại.' });
  });
}
```

Note: changing the password writes a new hash the user pastes into `.env` (no self-modifying env in a container). The response returns the hash to copy.

- [ ] **Step 5: Update `src/app.js` to wire sessions, auth, views, urlencoded**

```js
import express from 'express';
import cookieSession from 'cookie-session';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './config.js';
import { requireAuth, mountAuth } from './routes/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function buildApp(deps = {}) {
  const passwordHash = deps.passwordHash ?? config.PASSWORD_HASH;
  const sessionSecret = deps.sessionSecret ?? config.SESSION_SECRET;

  const app = express();
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

  app.use('/public', express.static(join(__dirname, 'public')));
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  mountAuth(app, { passwordHash });

  // everything below requires auth
  app.use(requireAuth);
  app.get('/', (req, res) => res.send('ok')); // replaced by pages.js in later task
  app.get('/api/library', (req, res) => res.json({ items: [] })); // replaced in Task 9

  return app;
}
```

Note: `/healthz` stays public and is registered before `requireAuth`. The `secure` cookie flag is handled by Caddy setting `X-Forwarded-Proto`; add `app.set('trust proxy', 1)` in Task 15.

- [ ] **Step 6: Create a minimal `src/views/login.ejs` so render works**

```html
<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Đăng nhập</title></head>
<body>
  <form method="post" action="/login">
    <% if (error) { %><p style="color:#FF2853"><%= error %></p><% } %>
    <input type="password" name="password" placeholder="Mật khẩu" autofocus>
    <button type="submit">Đăng nhập</button>
  </form>
</body></html>
```

(Styled properly in Task 10.)

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test tests/auth.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: single-password auth with session guard"
```

---

### Task 6: Image proxy + disk LRU cache

**Files:**
- Create: `src/cache/imageCache.js`, `src/routes/image.js`
- Modify: `src/app.js` (mount `/img` after `requireAuth`)
- Test: `tests/image.test.js`

**Interfaces:**
- Produces:
  - `createImageCache({ dir, maxBytes })` → `{ get(key), put(key, buf, contentType), prune() }`. `get` returns `{ buf, contentType } | null`. Key is a hash of the URL.
  - `isAllowedHost(url, allowSuffixes)` → boolean.
  - `mountImageProxy(app, { fetchFn, cache, allowSuffixes })` — `GET /img?u=<encoded url>`: reject non-whitelisted hosts with 403, serve from cache or fetch-with-Referer then cache.

- [ ] **Step 1: Write the failing test `tests/image.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { isAllowedHost } from '../src/routes/image.js';

const hash = bcrypt.hashSync('secret123', 10);
function agentApp() {
  const app = buildApp({
    passwordHash: hash, sessionSecret: 't',
    cacheDir: mkdtempSync(join(tmpdir(), 'imgc-')),
    imageFetchFn: async () => ({
      ok: true, status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }),
  });
  return app;
}

test('isAllowedHost enforces whitelist', () => {
  const allow = ['img.otruyenapi.com', 'otruyencdn.com'];
  assert.ok(isAllowedHost('https://sv1.otruyencdn.com/x.jpg', allow));
  assert.ok(isAllowedHost('https://img.otruyenapi.com/x.jpg', allow));
  assert.ok(!isAllowedHost('https://evil.com/x.jpg', allow));
});

test('/img rejects non-whitelisted host with 403', async () => {
  const agent = request.agent(agentApp());
  await agent.post('/login').type('form').send({ password: 'secret123' });
  const res = await agent.get('/img?u=' + encodeURIComponent('https://evil.com/a.jpg'));
  assert.equal(res.status, 403);
});

test('/img serves whitelisted image', async () => {
  const agent = request.agent(agentApp());
  await agent.post('/login').type('form').send({ password: 'secret123' });
  const url = 'https://sv1.otruyencdn.com/uploads/x/chapter_1/page_0.jpg';
  const res = await agent.get('/img?u=' + encodeURIComponent(url));
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
});

test('/img requires auth', async () => {
  const res = await request(agentApp()).get('/img?u=' + encodeURIComponent('https://img.otruyenapi.com/a.jpg'));
  assert.equal(res.status, 401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/image.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/cache/imageCache.js`**

```js
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const keyOf = (url) => createHash('sha1').update(url).digest('hex');

export function createImageCache({ dir, maxBytes = 2 * 1024 * 1024 * 1024 }) {
  mkdirSync(dir, { recursive: true });

  function paths(url) {
    const k = keyOf(url);
    return { bin: join(dir, k), meta: join(dir, k + '.type') };
  }

  return {
    get(url) {
      const { bin, meta } = paths(url);
      if (!existsSync(bin)) return null;
      const buf = readFileSync(bin);
      const contentType = existsSync(meta) ? readFileSync(meta, 'utf8') : 'application/octet-stream';
      // touch for LRU
      const now = new Date();
      try { writeFileSync(bin, buf); } catch {}
      return { buf, contentType };
    },
    put(url, buf, contentType) {
      const { bin, meta } = paths(url);
      writeFileSync(bin, buf);
      writeFileSync(meta, contentType || 'application/octet-stream');
      this.prune();
    },
    prune() {
      const files = readdirSync(dir).filter(f => !f.endsWith('.type'))
        .map(f => { const p = join(dir, f); const s = statSync(p); return { p, size: s.size, mtime: s.mtimeMs }; });
      let total = files.reduce((a, f) => a + f.size, 0);
      if (total <= maxBytes) return;
      files.sort((a, b) => a.mtime - b.mtime); // oldest first
      for (const f of files) {
        if (total <= maxBytes) break;
        try { unlinkSync(f.p); unlinkSync(f.p + '.type'); } catch {}
        total -= f.size;
      }
    },
  };
}
```

- [ ] **Step 4: Create `src/routes/image.js`**

```js
export function isAllowedHost(url, allowSuffixes) {
  let host;
  try { host = new URL(url).hostname; } catch { return false; }
  return allowSuffixes.some(s => host === s || host.endsWith('.' + s) || host.endsWith(s));
}

export function mountImageProxy(app, { fetchFn = fetch, cache, allowSuffixes }) {
  app.get('/img', async (req, res) => {
    const url = req.query.u;
    if (!url || !isAllowedHost(url, allowSuffixes)) return res.status(403).end();

    const cached = cache.get(url);
    if (cached) {
      res.set('Content-Type', cached.contentType);
      res.set('Cache-Control', 'public, max-age=604800');
      return res.end(cached.buf);
    }
    try {
      const referer = new URL(url).origin + '/';
      const upstream = await fetchFn(url, { headers: { Referer: referer, 'user-agent': 'web-truyen/1.0' } });
      if (!upstream.ok) return res.status(502).end();
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      const buf = Buffer.from(await upstream.arrayBuffer());
      cache.put(url, buf, contentType);
      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=604800');
      res.end(buf);
    } catch {
      res.status(502).end();
    }
  });
}
```

- [ ] **Step 5: Wire into `src/app.js`**

Add near the top imports:

```js
import { createImageCache } from './cache/imageCache.js';
import { mountImageProxy, isAllowedHost } from './routes/image.js';
```

Inside `buildApp`, after `app.use(requireAuth);`:

```js
  const cache = createImageCache({
    dir: deps.cacheDir ?? config.CACHE_DIR,
    maxBytes: 2 * 1024 * 1024 * 1024,
  });
  mountImageProxy(app, {
    fetchFn: deps.imageFetchFn ?? fetch,
    cache,
    allowSuffixes: ['img.otruyenapi.com', 'otruyencdn.com'],
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/image.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: authenticated image proxy with disk LRU cache"
```

---

### Task 7: Library service (follow/unfollow/list, reading progress)

**Files:**
- Create: `src/services/library.js`
- Test: `tests/library.test.js`

**Interfaces:**
- Consumes: a better-sqlite3 `db` with schema from Task 2; domain detail object from Task 3/4.
- Produces: `createLibrary(db)` →
  - `follow(detail)` — upsert into `comics` + replace `chapters` rows from `detail.chapters`.
  - `unfollow(slug)`
  - `isFollowed(slug)` → boolean
  - `listFollowed()` → array of comic rows joined with progress + unread count
  - `setProgress(slug, chapterName, imagePage)`
  - `getProgress(slug)` → `{ chapterName, imagePage } | null`
  - `chaptersOf(slug)` → ordered chapter rows

- [ ] **Step 1: Write the failing test `tests/library.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createLibrary } from '../src/services/library.js';

function setup() {
  const db = openDb(':memory:');
  createSchema(db);
  return createLibrary(db);
}

const detail = {
  slug: 'tien-nghich', name: 'Tiên Nghịch', thumbUrl: 't.jpg',
  status: 'ongoing', categories: ['Action'],
  chapters: [
    { name: '1', title: '', apiUrl: 'u1', order: 0 },
    { name: '2', title: '', apiUrl: 'u2', order: 1 },
  ],
};

test('follow then listFollowed returns the comic', () => {
  const lib = setup();
  lib.follow(detail);
  assert.ok(lib.isFollowed('tien-nghich'));
  const list = lib.listFollowed();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Tiên Nghịch');
});

test('progress round-trips', () => {
  const lib = setup();
  lib.follow(detail);
  lib.setProgress('tien-nghich', '1', 12);
  assert.deepEqual(lib.getProgress('tien-nghich'), { chapterName: '1', imagePage: 12 });
});

test('unfollow removes comic and chapters', () => {
  const lib = setup();
  lib.follow(detail);
  lib.unfollow('tien-nghich');
  assert.ok(!lib.isFollowed('tien-nghich'));
  assert.equal(lib.chaptersOf('tien-nghich').length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/library.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/services/library.js`**

```js
export function createLibrary(db) {
  const upsertComic = db.prepare(`
    INSERT INTO comics (slug, name, thumb_url, status, categories, last_chapter_seen, updated_at_source, followed_at)
    VALUES (@slug, @name, @thumb_url, @status, @categories, @last_chapter_seen, @updated_at_source, @followed_at)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, thumb_url=excluded.thumb_url, status=excluded.status,
      categories=excluded.categories, updated_at_source=excluded.updated_at_source
  `);
  const delChapters = db.prepare('DELETE FROM chapters WHERE comic_slug=?');
  const insChapter = db.prepare(`
    INSERT INTO chapters (comic_slug, chapter_name, chapter_title, api_url, order_index)
    VALUES (?,?,?,?,?)
    ON CONFLICT(comic_slug, chapter_name) DO UPDATE SET
      chapter_title=excluded.chapter_title, api_url=excluded.api_url, order_index=excluded.order_index
  `);

  const follow = db.transaction((detail) => {
    const latest = detail.chapters.at(-1)?.name ?? null;
    upsertComic.run({
      slug: detail.slug, name: detail.name, thumb_url: detail.thumbUrl,
      status: detail.status, categories: (detail.categories || []).join(', '),
      last_chapter_seen: latest, updated_at_source: detail.updatedAt || null,
      followed_at: Date.now(),
    });
    for (const c of detail.chapters) {
      insChapter.run(detail.slug, c.name, c.title || '', c.apiUrl, c.order);
    }
  });

  return {
    follow,
    unfollow(slug) {
      db.prepare('DELETE FROM comics WHERE slug=?').run(slug);
      delChapters.run(slug);
      db.prepare('DELETE FROM reading_progress WHERE comic_slug=?').run(slug);
    },
    isFollowed(slug) {
      return !!db.prepare('SELECT 1 FROM comics WHERE slug=?').get(slug);
    },
    listFollowed() {
      const comics = db.prepare('SELECT * FROM comics ORDER BY followed_at DESC').all();
      return comics.map(c => {
        const total = db.prepare('SELECT COUNT(*) n FROM chapters WHERE comic_slug=?').get(c.slug).n;
        const prog = db.prepare('SELECT * FROM reading_progress WHERE comic_slug=?').get(c.slug);
        let readCount = 0;
        if (prog) {
          const ord = db.prepare('SELECT order_index FROM chapters WHERE comic_slug=? AND chapter_name=?')
            .get(c.slug, prog.chapter_name);
          readCount = ord ? ord.order_index + 1 : 0;
        }
        return { ...c, totalChapters: total, readCount, unread: Math.max(0, total - readCount),
                 progress: prog ? { chapterName: prog.chapter_name, imagePage: prog.image_page } : null };
      });
    },
    setProgress(slug, chapterName, imagePage = 0) {
      db.prepare(`
        INSERT INTO reading_progress (comic_slug, chapter_name, image_page, updated_at)
        VALUES (?,?,?,?)
        ON CONFLICT(comic_slug) DO UPDATE SET
          chapter_name=excluded.chapter_name, image_page=excluded.image_page, updated_at=excluded.updated_at
      `).run(slug, chapterName, imagePage, Date.now());
    },
    getProgress(slug) {
      const p = db.prepare('SELECT * FROM reading_progress WHERE comic_slug=?').get(slug);
      return p ? { chapterName: p.chapter_name, imagePage: p.image_page } : null;
    },
    chaptersOf(slug) {
      return db.prepare('SELECT * FROM chapters WHERE comic_slug=? ORDER BY order_index').all(slug);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/library.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: library service (follow, progress)"
```

---

### Task 8: Updates service (check for new chapters)

**Files:**
- Create: `src/services/updates.js`
- Test: `tests/updates.test.js`

**Interfaces:**
- Consumes: `library` (Task 7), `source` (Task 4).
- Produces: `createUpdates({ library, source })` →
  - `checkOne(slug)` → `{ slug, name, newCount, latest }` — fetches detail, compares chapter count to stored, updates stored chapters, returns how many new.
  - `checkAll(onProgress)` → array of results; calls `onProgress(done, total, current)` per comic.

- [ ] **Step 1: Write the failing test `tests/updates.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createLibrary } from '../src/services/library.js';
import { createUpdates } from '../src/services/updates.js';

function make(chaptersAfter) {
  const db = openDb(':memory:');
  createSchema(db);
  const lib = createLibrary(db);
  lib.follow({ slug: 's', name: 'S', thumbUrl: '', status: 'ongoing', categories: [],
    chapters: [{ name: '1', title: '', apiUrl: 'u1', order: 0 }] });
  const source = {
    async detail() {
      return { slug: 's', name: 'S', thumbUrl: '', status: 'ongoing', categories: [], chapters: chaptersAfter };
    },
  };
  return createUpdates({ library: lib, source });
}

test('checkOne reports new chapters and stores them', async () => {
  const upd = make([
    { name: '1', title: '', apiUrl: 'u1', order: 0 },
    { name: '2', title: '', apiUrl: 'u2', order: 1 },
    { name: '3', title: '', apiUrl: 'u3', order: 2 },
  ]);
  const r = await upd.checkOne('s');
  assert.equal(r.newCount, 2);
  assert.equal(r.latest, '3');
});

test('checkOne reports zero when nothing new', async () => {
  const upd = make([{ name: '1', title: '', apiUrl: 'u1', order: 0 }]);
  const r = await upd.checkOne('s');
  assert.equal(r.newCount, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/updates.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Create `src/services/updates.js`**

```js
export function createUpdates({ library, source }) {
  async function checkOne(slug) {
    const before = library.chaptersOf(slug).length;
    const detail = await source.detail(slug);
    library.follow(detail); // upsert refreshes chapter list (already followed)
    const after = detail.chapters.length;
    return {
      slug,
      name: detail.name,
      newCount: Math.max(0, after - before),
      latest: detail.chapters.at(-1)?.name ?? null,
    };
  }

  async function checkAll(onProgress = () => {}) {
    const slugs = library.listFollowed().map(c => c.slug);
    const results = [];
    for (let i = 0; i < slugs.length; i++) {
      onProgress(i, slugs.length, slugs[i]);
      try { results.push(await checkOne(slugs[i])); }
      catch (err) { results.push({ slug: slugs[i], error: String(err.message || err) }); }
    }
    onProgress(slugs.length, slugs.length, null);
    return results;
  }

  return { checkOne, checkAll };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/updates.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: check-for-new-chapters service"
```

---

### Task 9: JSON API routes

**Files:**
- Create: `src/routes/api.js`
- Modify: `src/app.js` (build db/source/library/updates, mount API, remove placeholder `/api/library`)
- Test: `tests/api.test.js`

**Interfaces:**
- Consumes: `library`, `updates`, `source`.
- Produces: `mountApi(app, { source, library, updates })` with routes (all under `requireAuth`):
  - `GET /api/library` → `{ items: listFollowed() }`
  - `GET /api/search?q=` → `{ items }`
  - `GET /api/browse?type=&category=&page=` → `{ items, pagination }`
  - `GET /api/categories` → `{ items }`
  - `POST /api/follow` body `{ slug }` → fetches detail, follows → `{ ok, followed: true }`
  - `POST /api/unfollow` body `{ slug }` → `{ ok }`
  - `POST /api/progress` body `{ slug, chapter, page }` → `{ ok }`
  - `POST /api/check` body `{ slug? }` → checkOne or checkAll (returns aggregated results)
- `buildApp` accepts `deps.db`, `deps.source` for test injection; falls back to real db/source.

- [ ] **Step 1: Write the failing test `tests/api.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { buildApp } from '../src/app.js';

const hash = bcrypt.hashSync('secret123', 10);

function makeApp() {
  const db = openDb(':memory:');
  createSchema(db);
  const detail = {
    slug: 'tien-nghich', name: 'Tiên Nghịch', thumbUrl: 't.jpg', status: 'ongoing',
    categories: ['Action'], chapters: [{ name: '1', title: '', apiUrl: 'u1', order: 0 }],
  };
  const source = {
    async detail() { return detail; },
    async search() { return { items: [{ slug: 'tien-nghich', name: 'Tiên Nghịch' }] }; },
    async home() { return { items: [], pagination: null }; },
    async list() { return { items: [], pagination: null }; },
    async byCategory() { return { items: [], pagination: null }; },
    async categories() { return [{ name: 'Action', slug: 'action' }]; },
  };
  return buildApp({ passwordHash: hash, sessionSecret: 't', db, source });
}

async function authed() {
  const agent = request.agent(makeApp());
  await agent.post('/login').type('form').send({ password: 'secret123' });
  return agent;
}

test('follow then library lists it', async () => {
  const agent = await authed();
  const f = await agent.post('/api/follow').send({ slug: 'tien-nghich' });
  assert.equal(f.status, 200);
  const lib = await agent.get('/api/library');
  assert.equal(lib.body.items.length, 1);
  assert.equal(lib.body.items[0].slug, 'tien-nghich');
});

test('search proxies to source', async () => {
  const agent = await authed();
  const res = await agent.get('/api/search?q=tien');
  assert.equal(res.body.items[0].slug, 'tien-nghich');
});

test('progress saves and library reflects it', async () => {
  const agent = await authed();
  await agent.post('/api/follow').send({ slug: 'tien-nghich' });
  const p = await agent.post('/api/progress').send({ slug: 'tien-nghich', chapter: '1', page: 5 });
  assert.equal(p.status, 200);
  const lib = await agent.get('/api/library');
  assert.equal(lib.body.items[0].progress.imagePage, 5);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/api.test.js`
Expected: FAIL (`/api/follow` 404).

- [ ] **Step 3: Create `src/routes/api.js`**

```js
export function mountApi(app, { source, library, updates }) {
  app.get('/api/library', (req, res) => res.json({ items: library.listFollowed() }));

  app.get('/api/search', async (req, res) => {
    try { res.json(await source.search(req.query.q || '')); }
    catch (e) { res.status(502).json({ error: String(e.message || e) }); }
  });

  app.get('/api/browse', async (req, res) => {
    const page = Number(req.query.page || 1);
    try {
      if (req.query.category) return res.json(await source.byCategory(req.query.category, page));
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

  app.post('/api/unfollow', (req, res) => {
    library.unfollow(req.body.slug);
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
}
```

- [ ] **Step 4: Update `src/app.js` to build services and mount API**

Add imports:

```js
import { openDb } from './db/index.js';
import { createSchema } from './db/migrations.js';
import { createSource } from './source/otruyen.js';
import { createLibrary } from './services/library.js';
import { createUpdates } from './services/updates.js';
import { mountApi } from './routes/api.js';
```

Inside `buildApp`, before `return app;` and after the image proxy, replace the placeholder `/api/library`:

```js
  const db = deps.db ?? (() => { const d = openDb(config.DB_PATH); createSchema(d); return d; })();
  const source = deps.source ?? createSource({ base: config.OTRUYEN_BASE, cdnBase: config.CDN_IMAGE_BASE });
  const library = createLibrary(db);
  const updates = createUpdates({ library, source });

  mountApi(app, { source, library, updates });

  app.locals.services = { db, source, library, updates }; // used by pages.js
```

Remove the earlier placeholder line `app.get('/api/library', ...)` from Task 5.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/api.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: JSON API routes wired to services"
```

---

### Task 10: Frontend CSS + base layout + login styling

**Files:**
- Create: `src/public/css/styles.css`, `src/views/layout.ejs`, `src/views/partials/header.ejs`, `src/views/partials/comic-card.ejs`
- Modify: `src/views/login.ejs` (use layout + styling)
- Test: manual visual check (no unit test — this is presentation)

**Interfaces:**
- Produces: `styles.css` extracted from the mockup's `<style>` block (tokens, header, chip bar, comic grid card, sidebar, detail, reader, phone-not-needed parts dropped). `layout.ejs` renders `<head>` + header partial + `<%- body %>`. `comic-card.ejs` renders one grid card given a `comic` object.

- [ ] **Step 1: Extract CSS from the mockup**

Copy the token block and component styles from `docs/superpowers/specs/mockups/manga-ui.html` into `src/public/css/styles.css`. Keep the real-app-relevant sections: `:root` tokens + dark mode, `.topnav`, `.chipbar`/`.chips`/`.gchip`, `.wrap`/`.box`/`.boxhead`, `.cgrid`/`.cc` (comic card), `.pager`, `.col-side`/`.side-btn`/`.ranklist`/`.sysbox`, `.dhead`/`.dtitle`/`.numrow`/`.chgrid`/`.chi`, reader `.rd*`, `.foot`, and the mobile bottom-nav `.mtabs`. Drop the mockup-only chrome (`.browser`, `.phone`, `.notch`, `.stage`, `.switchbar`, `.notes`, `.tokens`, SVG placeholder art).

- [ ] **Step 2: Create `src/views/layout.ejs`**

```html
<!doctype html>
<html lang="vi" data-theme="<%= typeof theme !== 'undefined' ? theme : '' %>">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#EBEBEB">
  <link rel="manifest" href="/public/manifest.webmanifest">
  <link rel="stylesheet" href="/public/css/styles.css">
  <title><%= title %></title>
</head>
<body>
  <%- typeof hideHeader !== 'undefined' && hideHeader ? '' : include('partials/header', { active: typeof active !== 'undefined' ? active : '' }) %>
  <%- body %>
  <script src="/public/js/common.js" type="module"></script>
  <% if (typeof pageScript !== 'undefined') { %><script src="/public/js/<%= pageScript %>" type="module"></script><% } %>
</body>
</html>
```

- [ ] **Step 3: Create `src/views/partials/header.ejs`**

```html
<div class="topnav"><div class="topnav-in">
  <a class="logo" href="/">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h12a1 1 0 0 1 1 1v19l-7-4.4L5 22V3a1 1 0 0 1 1-1z"/></svg>
    Kệ Truyện
  </a>
  <nav class="mainnav">
    <a href="/" class="<%= active==='home'?'sel':'' %>">Trang chủ</a>
    <a href="/browse" class="<%= active==='browse'?'sel':'' %>">Thể loại</a>
    <a href="/following" class="<%= active==='following'?'sel':'' %>">Đang theo dõi</a>
    <a href="/status" class="<%= active==='status'?'sel':'' %>">Tình trạng</a>
  </nav>
  <a class="navsearch" href="/search">⌕ Tìm truyện…</a>
  <div class="who"><span class="nm">Bạn</span><span class="av">N</span></div>
</div></div>
```

- [ ] **Step 4: Create `src/views/partials/comic-card.ejs`**

```html
<a class="cc" href="/truyen/<%= comic.slug %>">
  <div class="thumb">
    <img loading="lazy" src="/img?u=<%= encodeURIComponent(comic.thumbUrl) %>" alt="<%= comic.name %>">
    <% if (comic.updatedAt) { %><span class="when"><%= comic.when || '' %></span><% } %>
    <% if (comic.unread) { %><span class="hotflag"><%= comic.unread %></span><% } %>
    <% if (comic.latestChapter) { %><span class="newflag">Chương <b><%= comic.latestChapter %></b></span><% } %>
  </div>
  <div class="tt"><%= comic.name %></div>
  <div class="row"><span class="ch">Chương <%= comic.latestChapter || '?' %></span></div>
</a>
```

- [ ] **Step 5: Rewrite `src/views/login.ejs` with styling**

```html
<!doctype html>
<html lang="vi"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex"><link rel="stylesheet" href="/public/css/styles.css">
  <title>Đăng nhập — Kệ Truyện</title>
</head><body class="login-body">
  <form class="login-card" method="post" action="/login">
    <div class="login-logo">Kệ <b>Truyện</b></div>
    <% if (error) { %><p class="login-err"><%= error %></p><% } %>
    <input type="password" name="password" placeholder="Mật khẩu" autofocus autocomplete="current-password">
    <button class="btn" type="submit">Đăng nhập</button>
  </form>
</body></html>
```

- [ ] **Step 6: Add login styles to `styles.css`**

```css
.login-body { min-height: 100vh; display: grid; place-items: center; background: var(--bg); }
.login-card { background: var(--card); border: 1px solid var(--line); border-radius: 8px;
  padding: 28px; width: 300px; display: flex; flex-direction: column; gap: 14px; }
.login-logo { font-size: 22px; font-weight: 700; text-align: center; }
.login-logo b { color: var(--hot); }
.login-card input { padding: 11px; border: 1px solid var(--line-2); border-radius: 4px; font-size: 15px; }
.login-err { color: var(--hot); margin: 0; font-size: 13px; text-align: center; }
```

- [ ] **Step 7: Create a minimal `src/public/js/common.js`** (theme + fetch helper used later)

```js
export async function api(path, opts) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}
window.api = api;
```

- [ ] **Step 8: Manual check**

Run: `npm start`, open `http://localhost:3000/login`, confirm the styled login card appears and logging in with the dev password redirects to `/`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: base layout, header, comic card, styled login"
```

---

### Task 11: Home + detail pages (server-rendered)

**Files:**
- Create: `src/routes/pages.js`, `src/views/home.ejs`, `src/views/detail.ejs`, `src/public/js/home.js`
- Modify: `src/app.js` (mount pages, remove placeholder `/`)
- Test: `tests/pages.test.js`

**Interfaces:**
- Consumes: `app.locals.services` (`library`, `source`).
- Produces: `mountPages(app)` with:
  - `GET /` → renders `home` with followed comics + a "reading" subset.
  - `GET /truyen/:slug` → fetches detail from source, renders `detail` with chapters, follow state, progress.
  - `GET /following`, `GET /browse`, `GET /search`, `GET /status`, `GET /settings` (browse/search can render a shell that `home.js`/fetch fills).
  - `GET /doc/:slug/:chapter` handled in Task 12.
- Helper `relTime(iso)` → Vietnamese relative time ("6 giờ", "2 ngày").

- [ ] **Step 1: Write the failing test `tests/pages.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { buildApp } from '../src/app.js';

const hash = bcrypt.hashSync('secret123', 10);

function makeApp() {
  const db = openDb(':memory:'); createSchema(db);
  const detail = {
    slug: 'tien-nghich', name: 'Tiên Nghịch', thumbUrl: 'https://img.otruyenapi.com/uploads/comics/t.jpg',
    origin: '', content: '<p>abc</p>', status: 'ongoing', categories: ['Action'],
    chapters: [{ name: '1', title: '', apiUrl: 'u1', order: 0 }],
  };
  const source = { async detail() { return detail; }, async home() { return { items: [], pagination: null }; } };
  return buildApp({ passwordHash: hash, sessionSecret: 't', db, source });
}
async function authed() { const a = request.agent(makeApp()); await a.post('/login').type('form').send({ password: 'secret123' }); return a; }

test('home renders for authed user', async () => {
  const agent = await authed();
  const res = await agent.get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /Kệ Truyện/);
});

test('detail page renders comic name and chapters', async () => {
  const agent = await authed();
  const res = await agent.get('/truyen/tien-nghich');
  assert.equal(res.status, 200);
  assert.match(res.text, /Tiên Nghịch/);
  assert.match(res.text, /Chương 1/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pages.test.js`
Expected: FAIL (`/truyen/...` 404).

- [ ] **Step 3: Create `src/routes/pages.js`**

```js
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
    res.render('home', { title: 'Kệ Truyện', active: 'home', items, reading });
  });

  app.get('/following', (req, res) => res.redirect('/'));

  app.get('/truyen/:slug', async (req, res) => {
    try {
      const detail = await svc().source.detail(req.params.slug);
      const followed = svc().library.isFollowed(detail.slug);
      const progress = svc().library.getProgress(detail.slug);
      res.render('detail', { title: detail.name, active: '', detail, followed, progress, relTime });
    } catch (e) {
      res.status(502).render('status', { title: 'Lỗi', active: '', error: String(e.message || e), sys: null });
    }
  });

  app.get('/browse', (req, res) => res.render('home', { title: 'Duyệt truyện', active: 'browse', items: [], reading: [], browse: true }));
  app.get('/search', (req, res) => res.render('home', { title: 'Tìm truyện', active: '', items: [], reading: [], search: true }));
}
```

Note: `browse`/`search` reuse `home.ejs` with a flag; `home.js` detects the flag and fetches via API. Keeps templates minimal.

- [ ] **Step 4: Create `src/views/home.ejs`**

```html
<% /* rendered inside layout via res.render pattern below */ %>
<%- include('partials/header', { active }) %>
<div class="wrap">
  <div class="col-main">
    <% if (reading && reading.length) { %>
    <div class="box">
      <div class="boxhead"><h2>Đang đọc</h2><div class="sp"></div><span class="cnt"><%= reading.length %></span></div>
      <div class="cgrid">
        <% reading.forEach(comic => { %><%- include('partials/comic-card', { comic }) %><% }) %>
      </div>
    </div>
    <% } %>
    <div class="box">
      <div class="boxhead"><h2><i>✦</i> <%= search ? 'Kết quả tìm' : (browse ? 'Duyệt truyện' : 'Đang theo dõi') %></h2>
        <div class="sp"></div>
        <% if (!search && !browse) { %><button class="side-btn" id="checkNew" type="button" style="width:auto;padding:8px 14px">Kiểm tra chương mới</button><% } %>
      </div>
      <% if (search) { %><div style="padding:12px"><input id="q" placeholder="Nhập tên truyện…" style="width:100%;padding:10px;border:1px solid var(--line-2);border-radius:4px"></div><% } %>
      <div class="cgrid" id="grid">
        <% items.forEach(comic => { %><%- include('partials/comic-card', { comic }) %><% }) %>
      </div>
    </div>
  </div>
  <aside class="col-side">
    <button class="side-btn" id="checkNewSide" type="button">Kiểm tra chương mới</button>
    <div class="box"><div class="boxhead"><h2>Tình trạng</h2></div>
      <div class="sysbox" id="sysbox">Nhấn "Kiểm tra chương mới" để cập nhật.</div></div>
  </aside>
</div>
```

The `res.render('home', ...)` must wrap with layout. Simplest: render layout by having `home.ejs` be a full page. To keep DRY with the header, we `include` the header here and skip the `layout.ejs` wrapper for content pages — set the page scripts inline. Adjust `mountPages` render calls to render full pages:

Replace `res.render('home', {...})` usage by making `home.ejs` a complete document. Prepend to `home.ejs`:

```html
<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><link rel="manifest" href="/public/manifest.webmanifest">
<link rel="stylesheet" href="/public/css/styles.css"><title><%= title %></title>
</head><body>
```

and append at the end:

```html
<script type="module" src="/public/js/home.js"></script>
</body></html>
```

(Do the same full-document wrapping for `detail.ejs`, `status.ejs`, `settings.ejs`. `layout.ejs` from Task 10 is optional — if using full-document templates, delete `layout.ejs` to avoid confusion.)

- [ ] **Step 5: Create `src/views/detail.ejs`** (full document)

```html
<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><link rel="stylesheet" href="/public/css/styles.css"><title><%= title %></title>
</head><body>
<%- include('partials/header', { active }) %>
<div class="wrap"><div class="col-main"><div class="box">
  <div class="dhead">
    <div class="big"><img src="/img?u=<%= encodeURIComponent(detail.thumbUrl) %>" alt="<%= detail.name %>"></div>
    <div>
      <h1 class="dtitle"><%= detail.name %></h1>
      <% if (detail.origin) { %><div class="dalt"><%= detail.origin %></div><% } %>
      <div class="tagrow" style="margin:8px 0"><% detail.categories.forEach(t => { %><span class="tag"><%= t %></span><% }) %></div>
      <div class="numrow">
        <div><b><%= detail.chapters.length %></b><span>Chương</span></div>
        <div><b><%= detail.status==='completed'?'Hoàn':'Đang ra' %></b><span>Trạng thái</span></div>
      </div>
      <div class="dbtns">
        <% const cur = progress ? progress.chapterName : (detail.chapters[0] && detail.chapters[0].name); %>
        <a class="btn" href="/doc/<%= detail.slug %>/<%= encodeURIComponent(cur) %>"><%= progress ? 'Đọc tiếp' : 'Đọc từ đầu' %></a>
        <button class="ghost <%= followed?'on':'' %>" id="followBtn" data-slug="<%= detail.slug %>"><%= followed ? '✓ Đang theo dõi' : '+ Theo dõi' %></button>
      </div>
    </div>
  </div>
  <div class="synop"><%- detail.content %></div>
</div>
<div class="box"><div class="boxhead"><h2>Danh sách chương</h2><div class="sp"></div><span class="cnt"><%= detail.chapters.length %> chương</span></div>
  <div class="chwrap"><div class="chgrid">
    <% const readName = progress && progress.chapterName; %>
    <% [...detail.chapters].reverse().forEach(ch => { %>
      <a class="chi <%= readName===ch.name?'here':'' %>" href="/doc/<%= detail.slug %>/<%= encodeURIComponent(ch.name) %>">
        <span class="n">Chương <%= ch.name %></span><span class="d"><%= ch.title || '' %></span></a>
    <% }) %>
  </div></div>
</div>
</div></div>
<script type="module" src="/public/js/home.js"></script>
</body></html>
```

- [ ] **Step 6: Create `src/public/js/home.js`**

```js
import { api } from './common.js';

const sys = document.getElementById('sysbox');

async function runCheck(btn) {
  if (btn) btn.disabled = true;
  if (sys) sys.textContent = 'Đang kiểm tra…';
  try {
    const { results } = await api('/api/check', { method: 'POST', body: '{}' });
    const withNew = results.filter(r => r.newCount > 0);
    const total = withNew.reduce((a, r) => a + r.newCount, 0);
    if (sys) sys.textContent = withNew.length
      ? `${withNew.length} truyện có ${total} chương mới`
      : 'Không có chương mới.';
    if (withNew.length) setTimeout(() => location.reload(), 900);
  } catch (e) {
    if (sys) sys.textContent = 'Lỗi kiểm tra: ' + e.message;
  } finally { if (btn) btn.disabled = false; }
}

document.getElementById('checkNew')?.addEventListener('click', e => runCheck(e.target));
document.getElementById('checkNewSide')?.addEventListener('click', e => runCheck(e.target));

// follow toggle on detail page
const fb = document.getElementById('followBtn');
fb?.addEventListener('click', async () => {
  const slug = fb.dataset.slug;
  const on = fb.classList.contains('on');
  try {
    await api(on ? '/api/unfollow' : '/api/follow', { method: 'POST', body: JSON.stringify({ slug }) });
    fb.classList.toggle('on');
    fb.textContent = on ? '+ Theo dõi' : '✓ Đang theo dõi';
  } catch (e) { alert('Lỗi: ' + e.message); }
});

// search page
const q = document.getElementById('q');
let t;
q?.addEventListener('input', () => {
  clearTimeout(t);
  t = setTimeout(async () => {
    const grid = document.getElementById('grid');
    if (!q.value.trim()) { grid.innerHTML = ''; return; }
    const { items } = await api('/api/search?q=' + encodeURIComponent(q.value));
    grid.innerHTML = items.map(c => `
      <a class="cc" href="/truyen/${c.slug}">
        <div class="thumb"><img loading="lazy" src="/img?u=${encodeURIComponent(c.thumbUrl || '')}" alt=""></div>
        <div class="tt">${c.name}</div></a>`).join('');
  }, 350);
});
```

- [ ] **Step 7: Update `src/app.js`**

Add `import { mountPages } from './routes/pages.js';`. After `mountApi(...)` and setting `app.locals.services`, call `mountPages(app);`. Remove the placeholder `app.get('/', ...)` from Task 5. Ensure `mountPages` is after `app.locals.services` is set.

- [ ] **Step 8: Run test to verify it passes**

Run: `node --test tests/pages.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: home, detail, search pages"
```

---

### Task 12: Reader page + reader.js (images, prefetch, progress)

**Files:**
- Create: `src/views/reader.ejs`, `src/public/js/reader.js`
- Modify: `src/routes/pages.js` (add `GET /doc/:slug/:chapter`)
- Test: `tests/reader.test.js`

**Interfaces:**
- Consumes: `library.chaptersOf`, `source.chapter`, `library.getProgress`, `library.setProgress`.
- Produces:
  - `GET /doc/:slug/:chapter` → resolves chapter's `apiUrl` from stored chapters (or fetches detail if unknown), calls `source.chapter(apiUrl)`, renders `reader` with `images`, prev/next chapter names, and saved page.
  - `reader.js` — lazy-loads images through `/img`, prefetches next 3, saves progress on scroll (debounced), keyboard nav, prev/next chapter buttons.

- [ ] **Step 1: Write the failing test `tests/reader.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { buildApp } from '../src/app.js';

const hash = bcrypt.hashSync('secret123', 10);
function makeApp() {
  const db = openDb(':memory:'); createSchema(db);
  const detail = { slug: 's', name: 'S', thumbUrl: '', origin:'', content:'', status:'ongoing', categories:[],
    chapters: [
      { name: '1', title: '', apiUrl: 'https://sv1.otruyencdn.com/v1/api/chapter/a', order: 0 },
      { name: '2', title: '', apiUrl: 'https://sv1.otruyencdn.com/v1/api/chapter/b', order: 1 },
    ] };
  const source = {
    async detail() { return detail; },
    async chapter(apiUrl) {
      return { images: [
        { page: 0, url: 'https://sv1.otruyencdn.com/uploads/x/chapter_1/page_0.jpg' },
        { page: 1, url: 'https://sv1.otruyencdn.com/uploads/x/chapter_1/page_1.jpg' },
      ] };
    },
  };
  return buildApp({ passwordHash: hash, sessionSecret: 't', db, source });
}
async function authed() { const a = request.agent(makeApp()); await a.post('/login').type('form').send({ password: 'secret123' }); return a; }

test('reader renders images through /img and shows next chapter', async () => {
  const agent = await authed();
  await agent.post('/api/follow').send({ slug: 's' });
  const res = await agent.get('/doc/s/1');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/img\?u=/);
  assert.match(res.text, /Chương 2/); // next-chapter control
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/reader.test.js`
Expected: FAIL (`/doc/...` 404).

- [ ] **Step 3: Add `GET /doc/:slug/:chapter` to `src/routes/pages.js`**

```js
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
```

- [ ] **Step 4: Create `src/views/reader.ejs`** (full document)

```html
<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><link rel="stylesheet" href="/public/css/styles.css">
<title><%= title %></title>
</head><body class="rd">
<div class="rdbar">
  <a class="bk" href="/truyen/<%= slug %>" aria-label="Quay lại">‹</a>
  <div class="ti"><div class="a"><%= name %></div><div class="b">Chương <%= chapterName %> · <%= images.length %> trang</div></div>
  <div class="sp"></div>
  <div class="rnav">
    <% if (prev) { %><a class="link" href="/doc/<%= slug %>/<%= encodeURIComponent(prev) %>"><button type="button">← Chương trước</button></a><% } %>
    <% if (next) { %><a class="link" href="/doc/<%= slug %>/<%= encodeURIComponent(next) %>"><button class="pri" type="button">Chương sau →</button></a><% } %>
  </div>
</div>

<div class="rdstage"><div class="rdcol" id="pages"
     data-slug="<%= slug %>" data-chapter="<%= chapterName %>" data-start="<%= startPage %>"
     data-next="<%= next || '' %>">
  <% images.forEach(img => { %>
    <div class="mpage" data-page="<%= img.page %>">
      <span class="pn"><%= img.page + 1 %> / <%= images.length %></span>
      <img loading="lazy" data-src="/img?u=<%= encodeURIComponent(img.url) %>" alt="trang <%= img.page + 1 %>">
    </div>
  <% }) %>
  <div class="endblk">
    <div class="lb">Hết chương <%= chapterName %></div>
    <div class="bg">
      <% if (next) { %><a href="/doc/<%= slug %>/<%= encodeURIComponent(next) %>"><button class="b1" type="button">Chương <%= next %> →</button></a><% } %>
      <a href="/truyen/<%= slug %>"><button class="b2" type="button">Danh sách chương</button></a>
    </div>
  </div>
</div></div>

<div class="rdfoot"><div class="track"><i id="track"></i></div>
  <div class="row"><div class="p" id="pageLabel">Trang 1 <s>/ <%= images.length %></s></div>
    <div class="p">Chương <%= chapterName %></div></div></div>

<script type="module" src="/public/js/reader.js"></script>
</body></html>
```

- [ ] **Step 5: Create `src/public/js/reader.js`**

```js
import { api } from './common.js';

const pages = document.getElementById('pages');
const slug = pages.dataset.slug;
const chapter = pages.dataset.chapter;
const startPage = Number(pages.dataset.start || 0);
const imgs = [...pages.querySelectorAll('.mpage img')];
const track = document.getElementById('track');
const pageLabel = document.getElementById('pageLabel');
const total = imgs.length;

// lazy-load + prefetch next 3 using IntersectionObserver
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target;
    const idx = imgs.indexOf(el);
    for (let i = idx; i < Math.min(imgs.length, idx + 4); i++) {
      const im = imgs[i];
      if (im.dataset.src) { im.src = im.dataset.src; delete im.dataset.src; }
    }
    io.unobserve(el);
  }
}, { rootMargin: '800px 0px' });
imgs.forEach(im => io.observe(im));

// jump to saved page
if (startPage > 0 && imgs[startPage]) {
  imgs[startPage].closest('.mpage').scrollIntoView();
}

// track current page + save progress (debounced)
let saveTimer;
function currentPage() {
  const mid = window.innerHeight / 2;
  let cur = 0;
  document.querySelectorAll('.mpage').forEach((m, i) => {
    const r = m.getBoundingClientRect();
    if (r.top < mid) cur = i;
  });
  return Math.min(cur, total - 1);
}
function onScroll() {
  const cur = currentPage();
  track.style.width = ((cur + 1) / total * 100) + '%';
  pageLabel.innerHTML = `Trang ${cur + 1} <s>/ ${total}</s>`;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/progress', { method: 'POST', body: JSON.stringify({ slug, chapter, page: cur }) }).catch(() => {});
  }, 700);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// keyboard: left/right = prev/next chapter
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') document.querySelector('.rnav .pri')?.closest('a')?.click();
  if (e.key === 'ArrowLeft') document.querySelector('.rnav button:not(.pri)')?.closest('a')?.click();
  if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
});
```

- [ ] **Step 6: Add reader-support CSS to `styles.css`**

```css
.rd .link { text-decoration: none; }
.mpage img { display: block; width: 100%; height: auto; background: #17161c; min-height: 120px; }
.rdcol { max-width: 760px; margin: 0 auto; }
```

(Most reader styles already came from the mockup extraction in Task 10.)

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test tests/reader.test.js`
Expected: PASS.

- [ ] **Step 8: Run full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: comic reader with lazy-load, prefetch, progress save"
```

---

### Task 13: PWA (manifest, service worker, icons)

**Files:**
- Create: `src/public/manifest.webmanifest`, `src/public/sw.js`, `src/public/icons/icon-192.png`, `src/public/icons/icon-512.png`
- Modify: `src/public/js/common.js` (register service worker)
- Test: `tests/pwa.test.js`

**Interfaces:**
- Produces: a valid web app manifest served at `/public/manifest.webmanifest`; a service worker that caches the app shell + CSS/JS (NOT comic images — those are large and proxied). Registration in `common.js`.

- [ ] **Step 1: Write the failing test `tests/pwa.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../src/app.js';

test('manifest is served with correct name', async () => {
  const app = buildApp({ passwordHash: '', sessionSecret: 't' });
  const res = await request(app).get('/public/manifest.webmanifest');
  assert.equal(res.status, 200);
  const m = JSON.parse(res.text);
  assert.equal(m.name, 'Kệ Truyện');
  assert.equal(m.display, 'standalone');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pwa.test.js`
Expected: FAIL (404).

- [ ] **Step 3: Create `src/public/manifest.webmanifest`**

```json
{
  "name": "Kệ Truyện",
  "short_name": "Kệ Truyện",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#EBEBEB",
  "theme_color": "#EBEBEB",
  "icons": [
    { "src": "/public/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/public/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 4: Create `src/public/sw.js`**

```js
const SHELL = 'shell-v1';
const ASSETS = ['/public/css/styles.css', '/public/js/common.js', '/public/js/home.js', '/public/js/reader.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k)))));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/public/')) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
  // API and /img always go to network (auth-gated, fresh)
});
```

- [ ] **Step 5: Generate placeholder icons**

Create two solid-color PNG icons (192 and 512) with the accent `#FF2853` background. Use any method (e.g. a one-off Node script with a PNG lib, or an online tool copied in). They must be real PNG files at the given paths. Acceptance: `file src/public/icons/icon-192.png` reports PNG image data, 192 x 192.

- [ ] **Step 6: Register SW in `src/public/js/common.js`**

Append:

```js
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/public/sw.js').catch(() => {}));
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test tests/pwa.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: PWA manifest, service worker, icons"
```

---

### Task 14: Status page + settings/change-password page

**Files:**
- Create: `src/views/status.ejs`, `src/views/settings.ejs`
- Modify: `src/routes/pages.js` (`GET /status`, `GET /settings`), `src/routes/api.js` (`GET /api/status`)
- Test: `tests/status.test.js`

**Interfaces:**
- Consumes: `library`, cache dir size.
- Produces:
  - `GET /api/status` → `{ followedCount, unreadTotal, cacheBytes, lastCheck }`.
  - `GET /status` renders the status page (reads `/api/status` client-side or server-side).
  - `GET /settings` renders change-password form posting to `/settings/password` (from Task 5), showing the returned hash to paste into `.env`.

- [ ] **Step 1: Write the failing test `tests/status.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { buildApp } from '../src/app.js';

const hash = bcrypt.hashSync('secret123', 10);
function makeApp() {
  const db = openDb(':memory:'); createSchema(db);
  const source = { async detail(){return {slug:'s',name:'S',thumbUrl:'',origin:'',content:'',status:'ongoing',categories:[],chapters:[]};} };
  return buildApp({ passwordHash: hash, sessionSecret: 't', db, source });
}
async function authed() { const a = request.agent(makeApp()); await a.post('/login').type('form').send({ password: 'secret123' }); return a; }

test('GET /api/status returns counts', async () => {
  const agent = await authed();
  const res = await agent.get('/api/status');
  assert.equal(res.status, 200);
  assert.ok('followedCount' in res.body);
  assert.ok('cacheBytes' in res.body);
});

test('change password returns a new hash to paste', async () => {
  const agent = await authed();
  const res = await agent.post('/settings/password').send({ current: 'secret123', next: 'newpass123' });
  assert.equal(res.status, 200);
  assert.ok(res.body.hash.startsWith('$2'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/status.test.js`
Expected: FAIL (`/api/status` 404).

- [ ] **Step 3: Add `GET /api/status` to `src/routes/api.js`**

Add a `cacheDir` param to `mountApi` and compute size:

```js
import { readdirSync, statSync } from 'node:fs';

function dirSize(dir) {
  try { return readdirSync(dir).reduce((a, f) => { try { return a + statSync(dir + '/' + f).size; } catch { return a; } }, 0); }
  catch { return 0; }
}
```

Inside `mountApi({ source, library, updates, cacheDir })` add:

```js
  app.get('/api/status', (req, res) => {
    const items = library.listFollowed();
    res.json({
      followedCount: items.length,
      unreadTotal: items.reduce((a, c) => a + (c.unread || 0), 0),
      cacheBytes: cacheDir ? dirSize(cacheDir) : 0,
      lastCheck: null,
    });
  });
```

Update the `mountApi(app, { source, library, updates })` call in `app.js` to pass `cacheDir: deps.cacheDir ?? config.CACHE_DIR`.

- [ ] **Step 4: Add page routes to `src/routes/pages.js`**

```js
  app.get('/status', (req, res) => res.render('status', { title: 'Tình trạng', active: 'status', error: null, sys: null }));
  app.get('/settings', (req, res) => res.render('settings', { title: 'Cài đặt', active: '' }));
```

- [ ] **Step 5: Create `src/views/status.ejs`** (full document)

```html
<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><link rel="stylesheet" href="/public/css/styles.css"><title><%= title %></title>
</head><body>
<%- include('partials/header', { active }) %>
<div class="wrap"><div class="col-main"><div class="box">
  <div class="boxhead"><h2>Tình trạng hệ thống</h2></div>
  <div class="sysbox" id="status">Đang tải…</div>
</div>
<div class="box" style="margin-top:14px"><div class="boxhead"><h2>Cài đặt</h2></div>
  <div class="sysbox"><a href="/settings">Đổi mật khẩu →</a></div></div>
</div></div>
<script type="module">
  import { api } from '/public/js/common.js';
  const el = document.getElementById('status');
  try {
    const s = await api('/api/status');
    el.innerHTML = `Nguồn: OTruyen API<br>Đang theo dõi: ${s.followedCount} bộ<br>` +
      `Chương chưa đọc: ${s.unreadTotal}<br>Cache ảnh: ${(s.cacheBytes/1e6).toFixed(1)} MB / 2000 MB`;
  } catch (e) { el.textContent = 'Lỗi: ' + e.message; }
</script>
</body></html>
```

- [ ] **Step 6: Create `src/views/settings.ejs`** (full document)

```html
<!doctype html>
<html lang="vi"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><link rel="stylesheet" href="/public/css/styles.css"><title><%= title %></title>
</head><body>
<%- include('partials/header', { active }) %>
<div class="wrap"><div class="col-main"><div class="box">
  <div class="boxhead"><h2>Đổi mật khẩu</h2></div>
  <div style="padding:14px; display:flex; flex-direction:column; gap:10px; max-width:420px">
    <input id="cur" type="password" placeholder="Mật khẩu hiện tại" style="padding:10px;border:1px solid var(--line-2);border-radius:4px">
    <input id="next" type="password" placeholder="Mật khẩu mới (≥6 ký tự)" style="padding:10px;border:1px solid var(--line-2);border-radius:4px">
    <button class="btn" id="save" type="button">Đổi mật khẩu</button>
    <div class="sysbox" id="out"></div>
  </div>
</div></div></div>
<script type="module">
  import { api } from '/public/js/common.js';
  document.getElementById('save').addEventListener('click', async () => {
    const out = document.getElementById('out');
    try {
      const r = await api('/settings/password', { method: 'POST', body: JSON.stringify({
        current: cur.value, next: next.value }) });
      out.innerHTML = 'Xong. Dán dòng này vào <code>.env</code> (PASSWORD_HASH) rồi khởi động lại:<br><code>' + r.hash + '</code>';
    } catch (e) { out.textContent = 'Lỗi: ' + e.message; }
  });
</script>
</body></html>
```

- [ ] **Step 7: Run test to verify it passes**

Run: `node --test tests/status.test.js`
Expected: PASS.

- [ ] **Step 8: Run full suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: status page and change-password settings"
```

---

### Task 15: Deployment — Docker, Caddy, one-command setup

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `scripts/setup-server.sh`, `README.md`
- Modify: `src/app.js` (`app.set('trust proxy', 1)`), `src/server.js` (run migrations on boot, nightly maintenance)
- Test: manual (build + boot) — documented acceptance

**Interfaces:**
- Produces: a container that runs the app; Caddy reverse-proxy with automatic HTTPS for the user's domain; a nightly maintenance tick (backup DB + prune cache) that keeps the VPS non-idle; an idempotent provisioning script.

- [ ] **Step 1: Add trust proxy in `src/app.js`**

At the start of `buildApp`, after `const app = express();`:

```js
  app.set('trust proxy', 1);
```

- [ ] **Step 2: Add migrations + nightly maintenance to `src/server.js`**

```js
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
```

Note: this `setInterval` is internal maintenance (backup/prune) — it does NOT call the OTruyen source, so it complies with the "no background source polling" constraint.

- [ ] **Step 3: Create `Dockerfile`**

```dockerfile
FROM node:20-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]
```

Note: build tools are for `better-sqlite3` native compile on ARM.

- [ ] **Step 4: Create `docker-compose.yml`**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data
      - ./cache:/app/cache
    expose:
      - "3000"
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - app
volumes:
  caddy_data:
  caddy_config:
```

- [ ] **Step 5: Create `Caddyfile`**

```
{$DOMAIN} {
	reverse_proxy app:3000
	encode gzip
	header -Server
}
```

Note: `DOMAIN` comes from `.env` (Caddy reads `{$DOMAIN}`). The compose `env_file` for caddy isn't set; pass `DOMAIN` via the compose environment — add `environment: [ "DOMAIN=${DOMAIN}" ]` to the caddy service, or run compose with `DOMAIN=` in `.env` (Compose interpolates `${DOMAIN}` in the file). Add to caddy service:

```yaml
    environment:
      - DOMAIN=${DOMAIN}
```

- [ ] **Step 6: Create `scripts/setup-server.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

# One-command provision for a fresh Ubuntu/Oracle Always Free VPS.
# Usage: DOMAIN=truyen.example.com ./scripts/setup-server.sh

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  echo "Creating .env — you MUST set PASSWORD_HASH and DOMAIN."
  cp .env.example .env
  SECRET=$(head -c 32 /dev/urandom | base64)
  sed -i "s|SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" .env
  echo "DOMAIN=${DOMAIN:-change-me.example.com}" >> .env
  echo "Generate a password hash: docker compose run --rm app node scripts/hash-password.js 'E521satan'"
  echo "Then paste it into .env as PASSWORD_HASH= and re-run this script."
  exit 0
fi

docker compose up -d --build
echo "Up. Open https://${DOMAIN:-your-domain} once DNS points here."
```

- [ ] **Step 7: Create `README.md`** with setup steps

Document: (1) point domain A-record to VPS IP, (2) `git clone`, (3) `DOMAIN=... ./scripts/setup-server.sh`, (4) generate hash with `docker compose run --rm app node scripts/hash-password.js 'E521satan'`, paste into `.env`, (5) re-run script, (6) recovery: rebuild by re-running the script — data survives in `./data` (and `./data/backups`). Note the reader should change the password via `/settings` after first login.

- [ ] **Step 8: Local acceptance (no real domain)**

Run: `docker compose build` then `docker compose run --rm app node --test`
Expected: image builds; full test suite passes inside the container.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: docker, caddy, one-command setup, nightly maintenance"
```

---

### Task 16: Live smoke test against the real API (manual, not CI)

**Files:**
- Create: `scripts/smoke-live.js`
- Test: this task IS the test — run manually against the real API.

**Interfaces:**
- Consumes: real `createSource` with default fetch.
- Produces: `scripts/smoke-live.js` that hits the real OTruyen API for home, a search, a detail, and one chapter, printing a pass/fail summary. Confirms fixtures still match reality.

- [ ] **Step 1: Create `scripts/smoke-live.js`**

```js
import { createSource } from '../src/source/otruyen.js';
import { config } from '../src/config.js';

const src = createSource({ base: config.OTRUYEN_BASE, cdnBase: config.CDN_IMAGE_BASE });
let fail = 0;
const check = (name, cond) => { console.log(`${cond ? '✓' : '✗'} ${name}`); if (!cond) fail++; };

const home = await src.home();
check('home returns items', home.items.length > 0);

const search = await src.search('yêu thần ký');
check('search returns items', search.items.length > 0);

const slug = search.items[0].slug;
const detail = await src.detail(slug);
check('detail has chapters', detail.chapters.length > 0);
check('cover url built', detail.thumbUrl.startsWith('http'));

const ch = await src.chapter(detail.chapters[0].apiUrl);
check('chapter has images', ch.images.length > 0);
check('image url built', ch.images[0].url.startsWith('http'));

console.log(fail ? `\n${fail} check(s) FAILED — API shape may have changed.` : '\nAll live checks passed.');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it**

Run: `npm run smoke`
Expected: all checks pass. If any fail, the API shape changed — update `normalize.js` and the fixtures, then re-run the affected unit tests.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: live smoke check against real OTruyen API"
```

---

## Self-Review

**Spec coverage:**
- §4 architecture (single Node process, SQLite, no external services) → Tasks 1, 2, 9, 15 ✓
- §5 OTruyen API (all endpoints) → Tasks 3, 4, 16 ✓
- §6 image proxy (whitelist, Referer, cache, LRU) → Task 6 ✓
- §7 data model (all 5 tables) → Task 2 ✓
- §8 UI (TruyenQQ layout, palette, fonts, home/detail/reader, mobile) → Tasks 10, 11, 12; mockup is the reference ✓
- §9 update checking (button, per-comic, no scheduler) → Tasks 8, 9, 11 ✓
- §10 auth (single password, bcrypt in .env, gate everything incl. /img, change password, noindex) → Tasks 5, 6, 14; noindex in templates ✓
- §11 error handling (retry, per-image fail, deleted comic, cache full) → Tasks 4, 6, 12; retry in source, 502 on failure, prune on cache full ✓
- §13 infra (Oracle Always Free, Docker, Caddy, one-command rebuild, backup, anti-idle) → Task 15 ✓
- §12 testing (source fixtures, image URL, proxy whitelist, progress, update detection, live smoke) → Tasks 3, 4, 6, 7, 8, 16 ✓
- PWA (§8 "Thêm vào màn hình chính") → Task 13 ✓

Gap noted and closed: "auto-check on open, max 1/6h" (§9 item 3) is deferred — the manual "Kiểm tra chương mới" button (Task 11) and per-comic refresh cover the core need; auto-on-open is a later enhancement layered on `/api/check`, not required for a working Phase 1. Flagged here rather than silently dropped.

**Placeholder scan:** The `mountAuth` first draft in Task 5 Step 4 intentionally shows a placeholder line, then Step 4 immediately gives the full no-placeholder implementation to replace it. All other steps contain real code.

**Type consistency:** `createSource` returns `{ home, list, search, categories, byCategory, detail, chapter }` — consumed consistently in Tasks 8, 9, 12, 16. `library` method names (`follow`, `unfollow`, `isFollowed`, `listFollowed`, `setProgress`, `getProgress`, `chaptersOf`) match across Tasks 7, 8, 9, 11, 12, 14. Domain object shapes (`detail.chapters[].{name,title,apiUrl,order}`, `chapter.images[].{page,url}`) are consistent between `normalize.js` (Task 3) and every consumer.

---

## Notes for the implementer

- **Run one task at a time**, in order. Each ends green and committed.
- **Never hit the real API in unit tests** — always inject `fetchFn`/fixtures. Only Task 16 touches the network, and it's manual.
- **The mockup** at `docs/superpowers/specs/mockups/manga-ui.html` is the visual source of truth. When extracting CSS, keep class names identical so the templates match.
- If `better-sqlite3` fails to install on the dev machine, ensure Node 20 and build tools (`python3`, `make`, `g++`/MSVC) are present; the Docker image already installs them.
