import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createSettings } from '../src/services/settings.js';
import { createSourceManager } from '../src/services/source-manager.js';

function setup(overrides = {}) {
  const db = openDb(':memory:');
  createSchema(db);
  const settings = createSettings(db);
  const cfg = { TRUYENQQ_MIRRORS: ['https://a.com'], OTRUYEN_BASE: 'https://o', CDN_IMAGE_BASE: 'https://cdn' };
  const mgr = createSourceManager({
    db, settings, config: cfg,
    wrap: (_db, raw) => raw,                       // bỏ cache cho dễ test
    makeResolver: () => ({ current: () => 'https://a.com', setCurrent() {}, reprobe: async () => 'https://a.com' }),
    makeTruyenQQ: ({ base }) => ({ id: 'truyenqq', base, setBase(b) { this.base = b; }, async home() { return { src: 'qq', base: this.base }; } }),
    makeSupplement: () => ({ id: 'otruyen', async home() { return { src: 'ot' }; } }),
    ...overrides,
  });
  return { db, settings, mgr };
}

test('mặc định dùng truyenqq và facade ủy quyền đúng', async () => {
  const { mgr } = setup();
  assert.equal(mgr.current(), 'truyenqq');
  assert.equal((await mgr.source.home()).src, 'qq');
});

test('setSource đổi sang otruyen, facade phản ánh ngay', async () => {
  const { mgr, settings } = setup();
  mgr.setSource('otruyen');
  assert.equal(settings.get('source'), 'otruyen');
  assert.equal((await mgr.source.home()).src, 'ot');
});

test('setSource từ chối nguồn lạ', () => {
  const { mgr } = setup();
  assert.throws(() => mgr.setSource('bậy'), /không hợp lệ/);
});

test('setSource xóa api_cache', () => {
  const { mgr, db } = setup();
  db.prepare('INSERT INTO api_cache (cache_key, payload, expires_at) VALUES (?,?,?)').run('k', '{}', Date.now() + 1e9);
  mgr.setSource('otruyen');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM api_cache').get().n, 0);
});

test('reprobe áp dụng domain sống lên nguồn đang chạy và xóa cache', async () => {
  let setTo = null;
  const { mgr, db } = setup({
    makeResolver: () => ({ current: () => 'https://x.com', setCurrent() {}, reprobe: async () => 'https://alive.com' }),
    makeTruyenQQ: ({ base }) => ({ id: 'truyenqq', base, setBase(b) { setTo = b; }, async home() { return { base }; } }),
  });
  db.prepare('INSERT INTO api_cache (cache_key, payload, expires_at) VALUES (?,?,?)').run('k', '{}', Date.now() + 1e9);
  const found = await mgr.reprobe();
  assert.equal(found, 'https://alive.com');
  assert.equal(setTo, 'https://alive.com');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM api_cache').get().n, 0);
});

test('reprobe ném lỗi khi resolver không tìm được domain', async () => {
  const { mgr } = setup({
    makeResolver: () => ({ current: () => 'https://x.com', setCurrent() {}, reprobe: async () => { throw new Error('chết hết'); } }),
  });
  await assert.rejects(() => mgr.reprobe(), /chết hết/);
});

test('applyDomain gọi setBase trên nguồn TruyenQQ đang chạy', async () => {
  let setTo = null;
  const { mgr } = setup({
    makeResolver: () => ({ current: () => 'https://new.com', setCurrent() {}, reprobe: async () => 'https://new.com' }),
    makeTruyenQQ: ({ base }) => ({ id: 'truyenqq', base, setBase(b) { setTo = b; }, async home() { return { base }; } }),
  });
  mgr.applyDomain('https://new.com');
  assert.equal(setTo, 'https://new.com');
});

// --- gộp nguồn: TruyenQQ chính + OTruyen bổ sung ---

function setupMerge(overrides = {}) {
  return setup({
    makeTruyenQQ: ({ base }) => ({
      base, setBase(b) { this.base = b; },
      async home() { return { items: [] }; },
      async search() { return { items: [{ name: 'Có Sẵn', slug: 'co-san' }] }; },
      async detail(slug) { return { slug, name: 'qq' }; },
    }),
    makeSupplement: () => ({
      async home() { return { items: [] }; },
      async search() { return { items: [{ name: 'Bộ Thiếu', slug: 'bo-thieu' }] }; },
      async detail(slug) { return { slug, name: 'ot' }; },
    }),
    ...overrides,
  });
}

test('nguồn truyenqq mặc định được bổ sung bằng kho otruyen', async () => {
  const { mgr } = setupMerge();
  const { items } = await mgr.source.search('x');
  assert.deepEqual(items.map(i => i.slug), ['co-san', 'ot~bo-thieu']);
  // slug có tiền tố đi về đúng adapter bổ sung
  assert.equal((await mgr.source.detail('ot~bo-thieu')).name, 'ot');
  assert.equal((await mgr.source.detail('co-san')).name, 'qq');
});

test('settings supplement=0 thì tắt bổ sung, chỉ còn nguồn chính', async () => {
  const db = openDb(':memory:');
  createSchema(db);
  const settings = createSettings(db);
  settings.set('supplement', '0');
  const { mgr } = setupMerge({ db, settings });
  const { items } = await mgr.source.search('x');
  assert.deepEqual(items.map(i => i.slug), ['co-san']);
});

test('đổi sang otruyen làm nguồn chính thì không bổ sung, slug không tiền tố', async () => {
  const { mgr } = setupMerge();
  mgr.setSource('otruyen');
  const { items } = await mgr.source.search('x');
  assert.deepEqual(items.map(i => i.slug), ['bo-thieu']);
});
