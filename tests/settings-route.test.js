import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { buildApp } from '../src/app.js';

const hash = bcrypt.hashSync('secret123', 10);

const PAGE_OK = '<html><head><title>Truyện tranh</title></head><body>' +
  'Thể loại <a href="/truyen-tranh/x-1">x</a>'.repeat(20) + '</body></html>';

function app({ probeFetch, prober, imageDoctor } = {}) {
  const db = openDb(':memory:');
  createSchema(db);
  return buildApp({
    passwordHash: hash, sessionSecret: 't', db,
    cacheDir: mkdtempSync(join(tmpdir(), 'imgc-')),
    imageFetchFn: async () => ({ ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1]).buffer }),
    probeFetch, prober, imageDoctor,
  });
}

async function login(a) { await a.post('/login').type('form').send({ password: 'secret123' }); }

test('trang /settings yêu cầu đăng nhập (chuyển hướng về /login)', async () => {
  const res = await request(app()).get('/settings');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /login/);
});

test('đổi nguồn qua POST /settings/source', async () => {
  const a = request.agent(app());
  await login(a);
  const res = await a.post('/settings/source').send({ source: 'otruyen' });
  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'otruyen');
});

test('POST /settings/source từ chối nguồn lạ', async () => {
  const a = request.agent(app());
  await login(a);
  const res = await a.post('/settings/source').send({ source: 'linhtinh' });
  assert.equal(res.status, 400);
});

test('POST /settings/domain từ chối địa chỉ rác', async () => {
  const a = request.agent(app());
  await login(a);
  const res = await a.post('/settings/domain').send({ domain: 'không phải url @@' });
  assert.equal(res.status, 400);
});

test('POST /settings/domain lưu khi domain sống (probe giả)', async () => {
  const probeFetch = async () => ({ ok: true, status: 200, async text() { return PAGE_OK; } });
  const a = request.agent(app({ probeFetch }));
  await login(a);
  const res = await a.post('/settings/domain').send({ domain: 'truyenqqmoi.example' });
  assert.equal(res.status, 200);
  assert.equal(res.body.domain, 'https://truyenqqmoi.example', 'tự thêm https:// và lưu');
});

test('POST /settings/domain từ chối domain chết (probe giả trả lỗi)', async () => {
  const probeFetch = async () => ({ ok: false, status: 502, async text() { return ''; } });
  const a = request.agent(app({ probeFetch }));
  await login(a);
  const res = await a.post('/settings/domain').send({ domain: 'https://chet.example' });
  assert.equal(res.status, 400);
});

test('POST /settings/reprobe tìm được domain sống (probe giả)', async () => {
  const probeFetch = async () => ({ ok: true, status: 200, async text() { return PAGE_OK; } });
  const a = request.agent(app({ probeFetch }));
  await login(a);
  const res = await a.post('/settings/reprobe');
  assert.equal(res.status, 200);
  assert.ok(res.body.domain, 'trả về domain sống');
});

test('POST /settings/reprobe báo 502 khi mọi domain chết', async () => {
  const probeFetch = async () => { throw new Error('mạng chết'); };
  const a = request.agent(app({ probeFetch }));
  await login(a);
  const res = await a.post('/settings/reprobe');
  assert.equal(res.status, 502);
});

test('bật/tắt bổ sung qua POST /settings/supplement', async () => {
  const a = request.agent(app());
  await login(a);

  const off = await a.post('/settings/supplement').send({ on: false });
  assert.equal(off.status, 200);
  assert.equal(off.body.supplement, false);

  const on = await a.post('/settings/supplement').send({ on: true });
  assert.equal(on.body.supplement, true);
});

/* ---------- Dò nguồn từ máy chủ ---------- */

const fakeProber = (sink = []) => ({
  async probeAll(list) {
    sink.push(list);
    return list.map(u => ({ input: u, ok: true, status: 200, ms: 120, theme: 'nettruyen', adapter: 'nettruyen.js', comicCount: 9 }));
  },
});

test('POST /settings/probe cần đăng nhập', async () => {
  const res = await request(app()).post('/settings/probe').send({ urls: ['a.com'] });
  assert.equal(res.status, 302);           // trang (không phải /api) -> đẩy về /login
  assert.match(res.headers.location, /login/);
});

test('POST /settings/probe dò đúng danh sách người dùng nhập', async () => {
  const sink = [];
  const a = request.agent(app({ prober: fakeProber(sink) }));
  await login(a);
  const res = await a.post('/settings/probe').send({ urls: ['mot.com', 'hai.com'] });
  assert.equal(res.status, 200);
  assert.deepEqual(sink[0], ['mot.com', 'hai.com']);
  assert.equal(res.body.results.length, 2);
  assert.equal(res.body.results[0].adapter, 'nettruyen.js');
});

test('POST /settings/probe bỏ trống thì dò danh sách ứng viên cài sẵn', async () => {
  const sink = [];
  const a = request.agent(app({ prober: fakeProber(sink) }));
  await login(a);
  const res = await a.post('/settings/probe').send({ urls: '' });
  assert.equal(res.status, 200);
  assert.ok(sink[0].length > 1, 'phải dùng danh sách cài sẵn');
  assert.ok(sink[0].every(u => /^https?:\/\//.test(u)));
});

test('POST /settings/probe nhận cả chuỗi nhiều dòng', async () => {
  const sink = [];
  const a = request.agent(app({ prober: fakeProber(sink) }));
  await login(a);
  await a.post('/settings/probe').send({ urls: 'mot.com\n hai.com ,ba.com' });
  assert.deepEqual(sink[0], ['mot.com', 'hai.com', 'ba.com']);
});

test('trang /settings liệt kê các nguồn truyện tranh đang đăng ký', async () => {
  const a = request.agent(app());
  await login(a);
  const res = await a.get('/settings');
  assert.match(res.text, /Dò nguồn từ máy chủ/);
  assert.match(res.text, /TruyenQQ/);
  assert.match(res.text, /NetTruyen 2/, 'phải thấy các kho bổ sung mới');
});

test('trang /settings hiện ô tick bổ sung theo trạng thái đang lưu', async () => {
  const a = request.agent(app());
  await login(a);

  const bat = await a.get('/settings');           // mặc định là bật
  assert.match(bat.text, /id="sup"[^>]*checked/);

  await a.post('/settings/supplement').send({ on: false });
  const tat = await a.get('/settings');
  assert.doesNotMatch(tat.text, /id="sup"[^>]*checked/);
});

/* ---------- Chẩn đoán ảnh vỡ từ máy chủ ---------- */

const fakeDoctor = (sink = []) => ({
  async diagnoseChapter(slug, chap) {
    sink.push([slug, chap]);
    return { imageUrl: 'https://cdn/x.jpg', allowed: true, comic: 'Bộ Thử', chapter: chap, imageCount: 35,
      attempts: [{ host: 'cdn', referer: 'https://a/', ok: false, status: 404, ms: 30 }],
      verdict: 'Host còn sống nhưng từ chối hết (mã 404)' };
  },
  async diagnoseUrl() { return { attempts: [], verdict: '' }; },
});

test('POST /settings/diagnose-image bóc đúng slug + chương từ link đầy đủ', async () => {
  const sink = [];
  const a = request.agent(app({ imageDoctor: fakeDoctor(sink) }));
  await login(a);
  const res = await a.post('/settings/diagnose-image')
    .send({ link: 'https://truyen.tradadata.com/doc/ot~dai-duong-song-long-truyen/19' });
  assert.equal(res.status, 200);
  assert.deepEqual(sink[0], ['ot~dai-duong-song-long-truyen', '19']);
  assert.equal(res.body.verdict, 'Host còn sống nhưng từ chối hết (mã 404)');
  assert.equal(res.body.attempts.length, 1);
});

test('POST /settings/diagnose-image nhận cả đường dẫn trống host', async () => {
  const sink = [];
  const a = request.agent(app({ imageDoctor: fakeDoctor(sink) }));
  await login(a);
  await a.post('/settings/diagnose-image').send({ link: '/doc/abc/7' });
  assert.deepEqual(sink[0], ['abc', '7']);
});

test('POST /settings/diagnose-image từ chối link không phải trang đọc', async () => {
  const a = request.agent(app({ imageDoctor: fakeDoctor() }));
  await login(a);
  const res = await a.post('/settings/diagnose-image').send({ link: 'https://truyen.tradadata.com/truyen/abc' });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Không nhận ra link chương/);
});

test('POST /settings/diagnose-image cần link, và cần đăng nhập', async () => {
  const chua = await request(app()).post('/settings/diagnose-image').send({ link: '/doc/a/1' });
  assert.equal(chua.status, 302);
  const a = request.agent(app({ imageDoctor: fakeDoctor() }));
  await login(a);
  const res = await a.post('/settings/diagnose-image').send({ link: '' });
  assert.equal(res.status, 400);
});

test('trang /settings có mục chẩn đoán ảnh', async () => {
  const a = request.agent(app());
  await login(a);
  const res = await a.get('/settings');
  assert.match(res.text, /Ảnh vỡ\? Hỏi máy chủ/);
  assert.match(res.text, /id="diagLink"/);
});
