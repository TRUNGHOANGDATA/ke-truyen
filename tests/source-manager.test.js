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

// --- nhiều site cùng khung NetTruyen: mỗi site là một kho riêng ---

const THREE_SITES = [
  { id: 'nettruyen', label: 'NetTruyen', base: 'https://mot.com', prefix: 'ot~', apiBase: 'https://api.mot' },
  { id: 'hai', label: 'NetTruyen 2', base: 'https://hai.com', prefix: 'nar~' },
  { id: 'ba', label: 'NetTruyen 3', base: 'https://ba.com', prefix: 'nx~' },
];

function setupSites(overrides = {}) {
  const db = openDb(':memory:');
  createSchema(db);
  const settings = createSettings(db);
  const seen = [];
  const mgr = createSourceManager({
    db, settings,
    config: { TRUYENQQ_MIRRORS: ['https://a.com'], NETTRUYEN_SITES: THREE_SITES },
    wrap: (_db, raw) => raw,
    makeResolver: () => ({ current: () => 'https://a.com', setCurrent() {}, reprobe: async () => 'https://a.com' }),
    makeTruyenQQ: ({ base }) => ({
      base, setBase(b) { this.base = b; },
      async home() { return { items: [] }; },
      async search() { return { items: [] }; },
      async detail(slug) { return { slug, name: 'qq' }; },
    }),
    makeSupplement: (opts) => {
      seen.push(opts);
      const host = new URL(opts.base).hostname;
      return {
        getBase: () => opts.base,
        async home() { return { items: [] }; },
        async search() { return { items: [{ name: 'Bộ ' + host, slug: 'bo-' + host }] }; },
        async detail(slug) { return { slug, name: host }; },
        async chapter(url) { return { via: host, url }; },
      };
    },
    ...overrides,
  });
  return { mgr, seen, settings };
}

test('mỗi site trong NETTRUYEN_SITES thành một nguồn dựng riêng, đúng base + apiBase', () => {
  const { seen } = setupSites();
  assert.deepEqual(seen.map(o => o.base), ['https://mot.com', 'https://hai.com', 'https://ba.com']);
  assert.equal(seen[0].apiBase, 'https://api.mot');
  assert.equal(seen[1].apiBase, '', 'site không khai apiBase thì phải rỗng để rơi về tìm kiếm HTML');
});

test('comicSources liệt kê nguồn chính + mọi kho, kèm nhãn và tiền tố', () => {
  const { mgr } = setupSites();
  assert.deepEqual(mgr.comicSources().map(s => [s.label, s.prefix]), [
    ['TruyenQQ', ''], ['NetTruyen', 'ot~'], ['NetTruyen 2', 'nar~'], ['NetTruyen 3', 'nx~'],
  ]);
});

test('detail và chapter về đúng site theo tiền tố / host', async () => {
  const { mgr } = setupSites();
  assert.equal((await mgr.source.detail('nar~x')).name, 'hai.com');
  assert.equal((await mgr.source.detail('nx~x')).name, 'ba.com');
  assert.equal((await mgr.source.detail('khong-tien-to')).name, 'qq');
  assert.equal((await mgr.source.chapter('https://ba.com/truyen-tranh/x/chuong-1')).via, 'ba.com');
});

test('tắt bổ sung thì comicSources chỉ còn nguồn chính', () => {
  const { mgr } = setupSites();
  mgr.setSupplement(false);
  assert.deepEqual(mgr.comicSources().map(s => s.label), ['TruyenQQ']);
});

// --- registry đa khung: chọn nguồn phụ làm chính + tự thêm nguồn ---

const REG_SITES = [
  { id: 'nettruyenar', label: 'NetTruyen', base: 'https://nar.com', prefix: 'nar~', framework: 'nettruyen' },
  { id: 'toptruyen', label: 'TopTruyen', base: 'https://top.com', prefix: 'ttz~', framework: 'toptruyen' },
];

function setupReg(overrides = {}) {
  const db = openDb(':memory:');
  createSchema(db);
  const settings = createSettings(db);
  const seen = { tqq: [], net: [], top: [] };
  const mgr = createSourceManager({
    db, settings,
    config: { TRUYENQQ_MIRRORS: ['https://a.com'], COMIC_SITES: REG_SITES },
    wrap: (_db, raw) => raw,
    makeResolver: () => ({ current: () => 'https://a.com', setCurrent() {}, reprobe: async () => 'https://a.com' }),
    makeTruyenQQ: ({ base }) => ({ id: 'truyenqq', base, setBase(b) { this.base = b; },
      async home() { return { items: [] }; }, async search() { return { items: [{ name: 'QQ', slug: 'qq' }] }; },
      async detail(slug) { return { slug, via: 'qq' }; } }),
    makeSupplement: (o) => { seen.net.push(o); return {
      getBase: () => o.base, async home() { return { items: [] }; },
      async search() { return { items: [{ name: 'Net', slug: 'net' }] }; }, async detail(slug) { return { slug, via: 'net' }; } }; },
    makeTopTruyen: (o) => { seen.top.push(o); return {
      getBase: () => o.base, async home() { return { items: [] }; },
      async search() { return { items: [{ name: 'Top', slug: 'top' }] }; }, async detail(slug) { return { slug, via: 'top' }; } }; },
    ...overrides,
  });
  return { db, settings, mgr, seen };
}

test('site khung toptruyen được dựng bằng makeTopTruyen, đúng base', () => {
  const { seen } = setupReg();
  assert.equal(seen.top.length, 1);
  assert.equal(seen.top[0].base, 'https://top.com');
});

test('setSource sang nguồn phụ (toptruyen) làm chính đứng riêng, slug không tiền tố', async () => {
  const { mgr, settings } = setupReg();
  mgr.setSource('toptruyen');
  assert.equal(settings.get('source'), 'toptruyen');
  const { items } = await mgr.source.search('x');
  assert.deepEqual(items.map(i => i.slug), ['top']);          // đứng riêng, không gộp
  assert.equal((await mgr.source.detail('top')).via, 'top');
});

test('listRegistry liệt kê TruyenQQ + mọi nguồn phụ, đánh dấu nguồn đang chính', () => {
  const { mgr } = setupReg();
  const reg = mgr.listRegistry();
  assert.deepEqual(reg.map(s => s.id), ['truyenqq', 'nettruyenar', 'toptruyen']);
  assert.equal(reg.find(s => s.active).id, 'truyenqq');
  mgr.setSource('toptruyen');
  assert.equal(mgr.listRegistry().find(s => s.active).id, 'toptruyen');
});

test('knownPrefixes gồm mọi nguồn phụ (để dọn bộ mồ côi)', () => {
  const { mgr } = setupReg();
  assert.deepEqual(mgr.knownPrefixes().sort(), ['nar~', 'ttz~']);
});

test('addSite lưu nguồn mới vào registry và chọn được làm chính', async () => {
  const { mgr } = setupReg();
  const site = mgr.addSite({ label: 'Kho Mới', base: 'https://www.komoi.net', framework: 'toptruyen' });
  assert.ok(mgr.listRegistry().some(s => s.id === site.id), 'registry phải có nguồn mới');
  assert.ok(site.prefix.endsWith('~'));
  mgr.setSource(site.id);
  assert.equal((await mgr.source.detail('x')).via, 'top');    // dùng đúng khung toptruyen
});

test('addSite từ chối khung chưa hỗ trợ và địa chỉ nội bộ (SSRF)', () => {
  const { mgr } = setupReg();
  assert.throws(() => mgr.addSite({ base: 'https://x.com', framework: 'madara' }), /Khung chưa hỗ trợ/);
  assert.throws(() => mgr.addSite({ base: 'http://127.0.0.1', framework: 'nettruyen' }), /không hợp lệ/);
});

test('addSite bền qua lần dựng manager mới (đọc lại từ settings)', () => {
  const { db, settings, mgr } = setupReg();
  const site = mgr.addSite({ label: 'Bền', base: 'https://ben.com', framework: 'nettruyen' });
  const mgr2 = createSourceManager({
    db, settings, config: { TRUYENQQ_MIRRORS: ['https://a.com'], COMIC_SITES: REG_SITES },
    wrap: (_db, raw) => raw,
    makeResolver: () => ({ current: () => 'https://a.com', setCurrent() {}, reprobe: async () => 'https://a.com' }),
    makeTruyenQQ: ({ base }) => ({ base, setBase() {}, async home() { return { items: [] }; } }),
    makeSupplement: () => ({ async home() { return { items: [] }; } }),
  });
  assert.ok(mgr2.listRegistry().some(s => s.id === site.id), 'nguồn tự thêm phải còn sau khi dựng lại');
});

test('removeSite gỡ nguồn tự thêm, không gỡ được nguồn cài sẵn', () => {
  const { mgr } = setupReg();
  const site = mgr.addSite({ label: 'Tạm', base: 'https://tam.com', framework: 'nettruyen' });
  mgr.removeSite(site.id);
  assert.ok(!mgr.listRegistry().some(s => s.id === site.id));
  assert.throws(() => mgr.removeSite('toptruyen'), /tự thêm/);
});
