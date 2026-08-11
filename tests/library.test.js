import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createLibrary } from '../src/services/library.js';

function setup() {
  const db = openDb(':memory:');
  createSchema(db);
  return createLibrary(db);
}

const detail = {
  slug: 'tien-nghich', name: 'Tiên Nghịch', thumbUrl: 't.jpg',
  status: 'ongoing', categories: ['Action'],
  chapters: [
    { name: '1', title: '', apiUrl: 'u1', order: 0 },
    { name: '2', title: '', apiUrl: 'u2', order: 1 },
  ],
};

test('follow then listFollowed returns the comic', () => {
  const lib = setup();
  lib.follow(detail);
  assert.ok(lib.isFollowed('tien-nghich'));
  const list = lib.listFollowed();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Tiên Nghịch');
});

test('progress round-trips', () => {
  const lib = setup();
  lib.follow(detail);
  lib.setProgress('tien-nghich', '1', 12);
  assert.deepEqual(lib.getProgress('tien-nghich'), { chapterName: '1', imagePage: 12 });
});

test('unfollow removes comic and chapters', () => {
  const lib = setup();
  lib.follow(detail);
  lib.unfollow('tien-nghich');
  assert.ok(!lib.isFollowed('tien-nghich'));
  assert.equal(lib.chaptersOf('tien-nghich').length, 0);
});
