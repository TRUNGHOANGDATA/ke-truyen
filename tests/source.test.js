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

test('list and byCategory ask the source to sort by updatedAt', async () => {
  const seen = [];
  const src = createSource({
    base: 'https://api.test/v1/api', cdnBase: 'https://img.test',
    fetchFn: async (url) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({ status: 'success', data: { items: [] } }) };
    },
  });
  await src.byCategory('manhua', 1);
  await src.list('truyen-moi', 2);
  // Thiếu tham số này thì nguồn sắp theo _id -> ra truyện cũ mấy năm trước
  assert.ok(seen[0].includes('sort_field=updatedAt'), seen[0]);
  assert.ok(seen[0].includes('sort_type=desc'), seen[0]);
  assert.ok(seen[1].includes('sort_field=updatedAt'), seen[1]);
});
