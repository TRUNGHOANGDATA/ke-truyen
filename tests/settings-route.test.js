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

function app({ probeFetch } = {}) {
  const db = openDb(':memory:');
  createSchema(db);
  return buildApp({
    passwordHash: hash, sessionSecret: 't', db,
    cacheDir: mkdtempSync(join(tmpdir(), 'imgc-')),
    imageFetchFn: async () => ({ ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([1]).buffer }),
    probeFetch,
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

test('trang /settings hiện ô tick bổ sung theo trạng thái đang lưu', async () => {
  const a = request.agent(app());
  await login(a);

  const bat = await a.get('/settings');           // mặc định là bật
  assert.match(bat.text, /id="sup"[^>]*checked/);

  await a.post('/settings/supplement').send({ on: false });
  const tat = await a.get('/settings');
  assert.doesNotMatch(tat.text, /id="sup"[^>]*checked/);
});
