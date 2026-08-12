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
    makeOtruyen: () => ({ id: 'otruyen', async home() { return { src: 'ot' }; } }),
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

test('applyDomain gọi setBase trên nguồn TruyenQQ đang chạy', async () => {
  let setTo = null;
  const { mgr } = setup({
    makeResolver: () => ({ current: () => 'https://new.com', setCurrent() {}, reprobe: async () => 'https://new.com' }),
    makeTruyenQQ: ({ base }) => ({ id: 'truyenqq', base, setBase(b) { setTo = b; }, async home() { return { base }; } }),
  });
  mgr.applyDomain('https://new.com');
  assert.equal(setTo, 'https://new.com');
});
