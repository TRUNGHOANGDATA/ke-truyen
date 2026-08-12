import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createSettings } from '../src/services/settings.js';
import { createDomainResolver, looksLikeTruyenQQ } from '../src/source/domain-resolver.js';

function settings() { const d = openDb(':memory:'); createSchema(d); return createSettings(d); }

const PAGE_OK = '<html><head><title>Truyện tranh</title></head><body>' +
  'Thể loại <a href="/truyen-tranh/abc-123">abc</a>'.repeat(20) + '</body></html>';
const PAGE_PARKED = '<html><body>Domain for sale</body></html>';

// fetchFn giả: map host -> phản hồi
function fake(map) {
  return async (url) => {
    for (const [host, val] of Object.entries(map)) {
      if (url.includes(host)) {
        if (val === 'throw') throw new Error('mạng lỗi');
        if (val === 'parked') return { ok: true, status: 200, async text() { return PAGE_PARKED; } };
        if (val === 'dead') return { ok: false, status: 502, async text() { return ''; } };
        return { ok: true, status: 200, async text() { return PAGE_OK; } };
      }
    }
    return { ok: false, status: 404, async text() { return ''; } };
  };
}

test('looksLikeTruyenQQ: đúng trang thì true, trang parking thì false', () => {
  assert.ok(looksLikeTruyenQQ(PAGE_OK));
  assert.ok(!looksLikeTruyenQQ(PAGE_PARKED));
  assert.ok(!looksLikeTruyenQQ(''));
});

test('reprobe bỏ qua domain chết/parking, chọn domain sống đầu tiên và ghi nhớ', async () => {
  const s = settings();
  const r = createDomainResolver({
    settings: s,
    candidates: ['https://d1.com', 'https://d2.com', 'https://d3.com'],
    fetchFn: fake({ 'd1.com': 'dead', 'd2.com': 'parked', 'd3.com': 'ok' }),
  });
  const found = await r.reprobe();
  assert.equal(found, 'https://d3.com');
  assert.equal(r.current(), 'https://d3.com');
  assert.equal(s.get('truyenqq_base'), 'https://d3.com', 'phải ghi nhớ vào settings');
});

test('reprobe bỏ qua domain ném lỗi mạng', async () => {
  const s = settings();
  const r = createDomainResolver({
    settings: s,
    candidates: ['https://d1.com', 'https://d2.com'],
    fetchFn: fake({ 'd1.com': 'throw', 'd2.com': 'ok' }),
  });
  assert.equal(await r.reprobe(), 'https://d2.com');
});

test('reprobe ném lỗi khi tất cả domain chết', async () => {
  const s = settings();
  const r = createDomainResolver({
    settings: s,
    candidates: ['https://d1.com', 'https://d2.com'],
    fetchFn: fake({ 'd1.com': 'dead', 'd2.com': 'throw' }),
  });
  await assert.rejects(() => r.reprobe(), /không truy cập được/);
});

test('domain đang lưu được thử trước tiên', async () => {
  const s = settings();
  s.set('truyenqq_base', 'https://saved.com');
  const tried = [];
  const r = createDomainResolver({
    settings: s,
    candidates: ['https://other.com'],
    fetchFn: async (url) => { tried.push(url); return { ok: true, status: 200, async text() { return PAGE_OK; } }; },
  });
  await r.reprobe();
  assert.match(tried[0], /saved\.com/, 'domain đã lưu phải được thử đầu tiên');
});

test('check() trả true/false cho domain sống/chết mà không ném', async () => {
  const s = settings();
  const r = createDomainResolver({ settings: s, candidates: ['https://x.com'], fetchFn: fake({ 'good.com': 'ok', 'bad.com': 'throw' }) });
  assert.equal(await r.check('https://good.com'), true);
  assert.equal(await r.check('https://bad.com'), false);
});

test('setCurrent lưu domain thủ công', () => {
  const s = settings();
  const r = createDomainResolver({ settings: s, candidates: ['https://x.com'] });
  r.setCurrent('https://manual.com/');
  assert.equal(r.current(), 'https://manual.com', 'bỏ dấu / cuối');
  assert.equal(s.get('truyenqq_base'), 'https://manual.com');
});
