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

const novelDetail = {
  kind: 'novel', slug: 'dai-chua-te', name: 'Đại Chúa Tể', origin: '',
  content: 'Giới thiệu.', status: 'completed',
  thumbUrl: 'https://static.truyenfull.live/cover/dai-chua-te.jpg',
  categories: ['Tiên Hiệp'], author: 'Thiên Tàm Thổ Đậu', updatedAt: null,
  chapters: [
    { name: '1', title: 'Bắc Linh viện', apiUrl: 'https://truyenfull.live/dai-chua-te/chuong-1/', order: 0 },
    { name: '2', title: 'Thiếu niên', apiUrl: 'https://truyenfull.live/dai-chua-te/chuong-2/', order: 1 },
  ],
};

const oneItem = [{ kind: 'novel', slug: 'dai-chua-te', name: 'Đại Chúa Tể', thumbUrl: novelDetail.thumbUrl, latestChapter: '2' }];
const novelSource = {
  async home() { return { items: oneItem }; },
  async list() { return { items: oneItem }; },
  async categories() { return [{ name: 'Tiên Hiệp', slug: 'tien-hiep' }, { name: 'Kiếm Hiệp', slug: 'kiem-hiep' }]; },
  async byCategory(slug) { return { items: slug === 'tien-hiep' ? oneItem : [] }; },
  async search(q) { return { items: q ? oneItem : [] }; },
  async detail() { return structuredClone(novelDetail); },
  async chapter() { return { title: 'Chương 1: Bắc Linh viện', paragraphs: ['Đoạn một.', 'Đoạn hai.'] }; },
};

function app() {
  const db = openDb(':memory:');
  createSchema(db);
  return buildApp({
    passwordHash: hash, sessionSecret: 't', db, novelSource,
    cacheDir: mkdtempSync(join(tmpdir(), 'nv-')),
  });
}
async function authed() { const a = request.agent(app()); await a.post('/login').type('form').send({ password: 'secret123' }); return a; }

test('/chu liệt kê truyện chữ, link card mang tiền tố tf~ -> /chu/<slug>', async () => {
  const a = await authed();
  const res = await a.get('/chu');
  assert.equal(res.status, 200);
  assert.match(res.text, /Đại Chúa Tể/);
  assert.match(res.text, /href="\/chu\/dai-chua-te"/);   // detailUrl bóc tiền tố tf~
});

test('/chu?q= tìm truyện chữ', async () => {
  const a = await authed();
  const res = await a.get('/chu?q=' + encodeURIComponent('đại chúa tể'));
  assert.equal(res.status, 200);
  assert.match(res.text, /Đại Chúa Tể/);
});

test('/chu/:slug hiện chi tiết + mục lục trỏ /doc-chu/', async () => {
  const a = await authed();
  const res = await a.get('/chu/dai-chua-te');
  assert.equal(res.status, 200);
  assert.match(res.text, /Truyện chữ/);                 // nhãn loại
  assert.match(res.text, /href="\/doc-chu\/dai-chua-te\/1"/);
  assert.match(res.text, /Thiên Tàm Thổ Đậu/);
});

test('/doc-chu/:slug/:chapter render đoạn văn + điều hướng chương sau', async () => {
  const a = await authed();
  const res = await a.get('/doc-chu/dai-chua-te/1');
  assert.equal(res.status, 200);
  assert.match(res.text, /Đoạn một\./);
  assert.match(res.text, /Đoạn hai\./);
  assert.match(res.text, /\/doc-chu\/dai-chua-te\/2/);  // link chương sau
});

test('đọc chương ghi truyện vào thư viện với slug tf~ (đang đọc dở)', async () => {
  const a = await authed();
  await a.get('/doc-chu/dai-chua-te/1');
  await a.post('/api/progress').send({ slug: 'tf~dai-chua-te', chapter: '1', page: 42 });
  // Trang chủ "đang đọc dở" phải link tới /chu/ chứ không phải /truyen/
  const home = await a.get('/');
  assert.match(home.text, /href="\/chu\/dai-chua-te"/);
  assert.doesNotMatch(home.text, /href="\/truyen\/tf~/);
});

test('theo dõi truyện chữ qua /api/novel/follow rồi bỏ theo dõi', async () => {
  const a = await authed();
  const f = await a.post('/api/novel/follow').send({ slug: 'dai-chua-te' });
  assert.equal(f.status, 200);
  assert.equal(f.body.followed, true);

  const detail = await a.get('/chu/dai-chua-te');
  assert.match(detail.text, /Đang theo dõi/);

  const u = await a.post('/api/unfollow').send({ slug: 'tf~dai-chua-te' });
  assert.equal(u.status, 200);
});

test('/chu hiện chip thể loại và lọc theo thể loại', async () => {
  const a = await authed();
  const all = await a.get('/chu');
  assert.match(all.text, /href="\/chu\?category=tien-hiep"/);   // chip thể loại
  assert.match(all.text, /Tiên Hiệp/);

  const filtered = await a.get('/chu?category=tien-hiep');
  assert.equal(filtered.status, 200);
  assert.match(filtered.text, /Đại Chúa Tể/);

  const empty = await a.get('/chu?category=kiem-hiep');
  assert.match(empty.text, /Không tìm thấy|Chưa có truyện/);
});

test('thẻ truyện chữ có nhãn "Chữ" phân biệt với truyện tranh', async () => {
  const a = await authed();
  const res = await a.get('/chu');
  assert.match(res.text, /class="kindflag">Chữ</);
});

test('truyện chữ đang đọc dở ở trang chủ mang nhãn "Chữ"', async () => {
  const a = await authed();
  await a.get('/doc-chu/dai-chua-te/1');   // tạo tiến độ đọc
  await a.post('/api/progress').send({ slug: 'tf~dai-chua-te', chapter: '1', page: 10 });
  const home = await a.get('/');
  assert.match(home.text, /class="kindflag">Chữ</);
});
