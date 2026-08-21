import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { withCache } from '../src/source/cached.js';

function setup(impl, opts) {
  const db = openDb(':memory:');
  createSchema(db);
  return { db, src: withCache(db, impl, opts) };
}
const expireAll = (db) => db.prepare('UPDATE api_cache SET expires_at = 0').run();

test('byCategory hits the source once, then serves from cache', async () => {
  let calls = 0;
  const { src } = setup({ async byCategory() { calls++; return { items: [{ slug: 'a' }], pagination: null }; } });
  const a = await src.byCategory('action', 1);
  const b = await src.byCategory('action', 1);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
});

test('different category/page are cached separately', async () => {
  let calls = 0;
  const { src } = setup({ async byCategory() { calls++; return { items: [], pagination: null }; } });
  await src.byCategory('action', 1);
  await src.byCategory('manhua', 1);
  await src.byCategory('action', 2);
  assert.equal(calls, 3);
});

test('re-fetches after the cache entry expires', async () => {
  let calls = 0;
  const { db, src } = setup({ async home() { calls++; return { items: [{ slug: 's' + calls }], pagination: null }; } });
  await src.home();
  expireAll(db);
  const second = await src.home();
  assert.equal(calls, 2);
  assert.equal(second.items[0].slug, 's2');
});

test('falls back to the stale entry when the source fails after expiry', async () => {
  let fail = false;
  const { db, src } = setup({
    async home() {
      if (fail) throw new Error('nguồn lỗi');
      return { items: [{ slug: 'ok' }], pagination: null };
    },
  });
  await src.home();
  expireAll(db);   // buộc phải gọi lại nguồn
  fail = true;     // ...và nguồn lỗi
  const res = await src.home();
  assert.equal(res.items[0].slug, 'ok'); // dùng bản cũ, trang không vỡ
});

test('propagates the error when nothing is cached yet', async () => {
  const { src } = setup({ async home() { throw new Error('nguồn lỗi'); } });
  await assert.rejects(() => src.home(), /nguồn lỗi/);
});

test('chapter được cache khi bật chapterTtlMs (chương bất biến)', async () => {
  let calls = 0;
  const { src } = setup(
    { async chapter(url) { calls++; return { images: [{ page: 0, url: url + '/p0' }] }; } },
    { chapterTtlMs: 60000 },
  );
  const a = await src.chapter('https://x/chuong-1');
  const b = await src.chapter('https://x/chuong-1');
  await src.chapter('https://x/chuong-2');
  assert.equal(calls, 2);              // chuong-1 chỉ gọi 1 lần, chuong-2 gọi 1 lần
  assert.deepEqual(a, b);
});

test('không bật chapterTtlMs thì chapter không cache (mặc định)', async () => {
  let calls = 0;
  const { src } = setup({ async chapter() { calls++; return { images: [] }; } });
  await src.chapter('u'); await src.chapter('u');
  assert.equal(calls, 2);
});
