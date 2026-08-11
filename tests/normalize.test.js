import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coverUrl, mapDetail, mapChapterImages } from '../src/source/normalize.js';

const detail = JSON.parse(readFileSync(new URL('./fixtures/detail.json', import.meta.url)));
const chapter = JSON.parse(readFileSync(new URL('./fixtures/chapter.json', import.meta.url)));

test('coverUrl joins cdn base and thumb', () => {
  assert.equal(
    coverUrl('https://img.otruyenapi.com', 'x.jpg'),
    'https://img.otruyenapi.com/uploads/comics/x.jpg'
  );
});

test('mapDetail flattens chapters in order', () => {
  const d = mapDetail(detail.data);
  assert.equal(d.slug, 'tien-nghich');
  assert.equal(d.categories[0], 'Action');
  assert.equal(d.chapters.length, 2);
  assert.equal(d.chapters[0].name, '1');
  assert.equal(d.chapters[0].order, 0);
  assert.equal(d.chapters[1].apiUrl, 'https://sv1.otruyencdn.com/v1/api/chapter/bbb');
});

test('mapChapterImages builds full image urls', () => {
  const c = mapChapterImages(chapter.data);
  assert.equal(c.images.length, 2);
  assert.equal(c.images[0].url,
    'https://sv1.otruyencdn.com/uploads/20240606/abc/chapter_1/page_0.jpg');
  assert.equal(c.images[0].page, 0);
});
