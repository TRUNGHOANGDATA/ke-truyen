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

test('remember() stores a comic without marking it followed', () => {
  const lib = setup();
  lib.remember(detail);
  assert.ok(lib.inLibrary('tien-nghich'));
  assert.equal(lib.isFollowed('tien-nghich'), false);
});

test('reading progress shows up in listReading even when not followed', () => {
  const lib = setup();
  lib.remember(detail);
  lib.setProgress('tien-nghich', '1', 4);
  const reading = lib.listReading();
  assert.equal(reading.length, 1);
  assert.equal(reading[0].slug, 'tien-nghich');
  assert.equal(reading[0].progress.imagePage, 4);
  assert.equal(lib.listFollowed().length, 0); // vẫn không nằm trong "đang theo dõi"
});

test('remember() does not downgrade an already-followed comic', () => {
  const lib = setup();
  lib.follow(detail);
  lib.remember(detail);
  assert.ok(lib.isFollowed('tien-nghich'));
});

test('unfollow keeps reading history but drops it from the followed list', () => {
  const lib = setup();
  lib.follow(detail);
  lib.setProgress('tien-nghich', '2', 7);
  lib.unfollow('tien-nghich');
  assert.equal(lib.isFollowed('tien-nghich'), false);
  assert.equal(lib.listFollowed().length, 0);
  assert.equal(lib.listReading().length, 1); // vẫn đọc tiếp được
});

test('clearProgress removes a read-only comic from the library entirely', () => {
  const lib = setup();
  lib.remember(detail);
  lib.setProgress('tien-nghich', '1', 2);
  lib.clearProgress('tien-nghich');
  assert.equal(lib.listReading().length, 0);
  assert.equal(lib.inLibrary('tien-nghich'), false);
});

test('clearProgress keeps a followed comic in the library', () => {
  const lib = setup();
  lib.follow(detail);
  lib.setProgress('tien-nghich', '1', 2);
  lib.clearProgress('tien-nghich');
  assert.equal(lib.listReading().length, 0);
  assert.ok(lib.isFollowed('tien-nghich'));
});

test('listTracked covers both followed and merely-being-read comics', () => {
  const lib = setup();
  lib.follow(detail);
  lib.remember({ ...detail, slug: 'other', name: 'Khác' });
  lib.setProgress('other', '1', 0);
  const slugs = lib.listTracked().map(c => c.slug).sort();
  assert.deepEqual(slugs, ['other', 'tien-nghich']);
});
