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
function makeApp() {
  const db = openDb(':memory:'); createSchema(db);
  const detail = { slug: 's', name: 'S', thumbUrl: '', origin: '', content: '', status: 'ongoing', categories: [],
    chapters: [
      { name: '1', title: '', apiUrl: 'https://sv1.otruyencdn.com/v1/api/chapter/a', order: 0 },
      { name: '2', title: '', apiUrl: 'https://sv1.otruyencdn.com/v1/api/chapter/b', order: 1 },
    ] };
  const source = {
    async detail() { return detail; },
    async chapter() {
      return { images: [
        { page: 0, url: 'https://sv1.otruyencdn.com/uploads/x/chapter_1/page_0.jpg' },
        { page: 1, url: 'https://sv1.otruyencdn.com/uploads/x/chapter_1/page_1.jpg' },
      ] };
    },
  };
  return buildApp({
    passwordHash: hash, sessionSecret: 't', db, source,
    cacheDir: mkdtempSync(join(tmpdir(), 'wt-')),
  });
}
async function authed() { const a = request.agent(makeApp()); await a.post('/login').type('form').send({ password: 'secret123' }); return a; }

test('reader renders images through /img and shows next chapter', async () => {
  const agent = await authed();
  await agent.post('/api/follow').send({ slug: 's' });
  const res = await agent.get('/doc/s/1');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/img\?i=/); // URL ảnh đã gói, không lộ host CDN
  assert.match(res.text, /Chương 2/); // next-chapter control
});

test('/api/chapter-images trả URL ảnh đã gói qua /img (để prefetch chương sau)', async () => {
  const agent = await authed();
  const res = await agent.get('/api/chapter-images?slug=s&chapter=1');
  assert.equal(res.status, 200);
  assert.equal(res.body.images.length, 2);
  assert.match(res.body.images[0], /^\/img\?i=/);       // đã gói, không lộ host CDN
  assert.doesNotMatch(res.body.images[0], /otruyencdn|http/);
});

test('/api/other-sources tìm cùng bộ ở nguồn khác (so tên) + link cùng chương', async () => {
  const db = openDb(':memory:'); createSchema(db);
  // manager giả: có 2 nguồn tranh, NetTruyen có bộ trùng tên
  const manager = {
    comicSources: () => [
      { id: 'truyenqq', label: 'TruyenQQ', prefix: '', src: { async search() { return { items: [] }; } } },
      { id: 'nettruyen', label: 'NetTruyen', prefix: 'ot~', src: { async search() { return { items: [{ name: 'TỨ ĐẠI DANH BỔ', slug: 'tu-dai-danh-bo' }] }; } } },
    ],
  };
  const app = buildApp({ passwordHash: hash, sessionSecret: 't', db, manager,
    cacheDir: mkdtempSync(join(tmpdir(), 'os-')) });
  const a = request.agent(app);
  await a.post('/login').type('form').send({ password: 'secret123' });
  // đang đọc bản TruyenQQ (slug thường) -> gợi ý NetTruyen, cùng chương 5
  const res = await a.get('/api/other-sources?slug=tu-dai-danh-bo-1463&name=' + encodeURIComponent('Tứ Đại Danh Bổ') + '&chapter=5');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.sources, [
    { n: 1, id: 'truyenqq', label: 'TruyenQQ', current: true, url: '/doc/tu-dai-danh-bo-1463/5' },
    { n: 2, id: 'nettruyen', label: 'NetTruyen', current: false, url: '/doc/ot~tu-dai-danh-bo/5' },
  ]);
});

test('/api/other-sources với NHIỀU kho: đánh dấu kho đang đọc, liệt kê các kho còn lại', async () => {
  const db = openDb(':memory:'); createSchema(db);
  const site = (id, label, prefix, slug) => ({
    id, label, prefix,
    src: { async search() { return { items: slug ? [{ name: 'Tứ Đại Danh Bổ', slug }] : [] }; } },
  });
  const manager = {
    comicSources: () => [
      site('truyenqq', 'TruyenQQ', '', 'tu-dai-danh-bo-1463'),
      site('nettruyen', 'NetTruyen', 'ot~', 'tu-dai-danh-bo'),
      site('hai', 'NetTruyen 2', 'nar~', 'tu-dai-danh-bo-1463'),
      site('ba', 'NetTruyen 3', 'nx~', null),          // kho này không có bộ đó
    ],
  };
  const app = buildApp({ passwordHash: hash, sessionSecret: 't', db, manager,
    cacheDir: mkdtempSync(join(tmpdir(), 'os2-')) });
  const a = request.agent(app);
  await a.post('/login').type('form').send({ password: 'secret123' });

  // đang đọc ở kho 'nar~' -> nó vẫn có mặt nhưng ĐƯỢC ĐÁNH DẤU current
  const res = await a.get('/api/other-sources?slug=nar~tu-dai-danh-bo-1463&name='
    + encodeURIComponent('Tứ Đại Danh Bổ') + '&chapter=12');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.sources.map(s => [s.n, s.label, s.current, s.url]), [
    [1, 'TruyenQQ', false, '/doc/tu-dai-danh-bo-1463/12'],
    [2, 'NetTruyen', false, '/doc/ot~tu-dai-danh-bo/12'],
    [3, 'NetTruyen 2', true, '/doc/nar~tu-dai-danh-bo-1463/12'],
  ]);
  assert.ok(!res.body.sources.some(s => s.label === 'NetTruyen 3'), 'kho không có bộ thì không hiện');
});

test('/api/other-sources nhớ kết quả: chương sau của cùng bộ không tra lại nguồn', async () => {
  const db = openDb(':memory:'); createSchema(db);
  let lanTra = 0;
  const manager = {
    comicSources: () => [
      { id: 'truyenqq', label: 'TruyenQQ', prefix: '', src: { async search() { lanTra++; return { items: [] }; } } },
      { id: 'nettruyen', label: 'NetTruyen', prefix: 'ot~', src: { async search() { lanTra++; return { items: [{ name: 'Tứ Đại Danh Bổ', slug: 'tu-dai-danh-bo' }] }; } } },
    ],
  };
  const app = buildApp({ passwordHash: hash, sessionSecret: 't', db, manager,
    cacheDir: mkdtempSync(join(tmpdir(), 'os3-')) });
  const a = request.agent(app);
  await a.post('/login').type('form').send({ password: 'secret123' });
  const q = (ch) => '/api/other-sources?slug=tu-dai-danh-bo-1463&name='
    + encodeURIComponent('Tứ Đại Danh Bổ') + '&chapter=' + ch;

  const ch1 = await a.get(q(1));
  const sau = lanTra;
  assert.ok(sau > 0, 'lần đầu phải tra nguồn');

  const ch2 = await a.get(q(2));
  assert.equal(lanTra, sau, 'chương sau không được tra lại');
  // vẫn phải ra link ĐÚNG chương đang đọc, không phải link đã cache của chương 1
  assert.equal(ch1.body.sources[1].url, '/doc/ot~tu-dai-danh-bo/1');
  assert.equal(ch2.body.sources[1].url, '/doc/ot~tu-dai-danh-bo/2');
});
