import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createLibrary } from '../src/services/library.js';

function seed(db, slug) {
  db.prepare('INSERT INTO comics (slug,name,followed,followed_at) VALUES (?,?,1,?)').run(slug, 'Bo ' + slug, Date.now());
  db.prepare('INSERT INTO reading_progress (comic_slug,chapter_name,image_page,updated_at) VALUES (?,?,?,?)').run(slug, '1', 0, Date.now());
  db.prepare('INSERT INTO chapters (comic_slug,chapter_name,api_url,order_index) VALUES (?,?,?,?)').run(slug, '1', 'u', 0);
}

test('purgeByPrefixes xoá đúng bộ mang tiền tố, giữ nguyên TruyenQQ và truyện chữ', () => {
  const db = openDb(':memory:'); createSchema(db);
  const lib = createLibrary(db);
  ['nguyen-ton-3755', 'ot~dai-duong', 'nar~tu-dai', 'nx~abc', 'tf~truyen-chu'].forEach(s => seed(db, s));

  const removed = lib.purgeByPrefixes(['ot~', 'nar~', 'nx~', 'nco~']);
  assert.equal(removed, 3);

  const left = db.prepare('SELECT slug FROM comics ORDER BY slug').all().map(r => r.slug);
  assert.deepEqual(left, ['nguyen-ton-3755', 'tf~truyen-chu'], 'chỉ còn TruyenQQ + truyện chữ');
  // dọn sạch cả tiến độ + mục lục của bộ đã xoá
  assert.equal(db.prepare("SELECT COUNT(*) n FROM reading_progress WHERE comic_slug LIKE 'ot~%'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM chapters WHERE comic_slug LIKE 'nar~%'").get().n, 0);
});

test('purgeByPrefixes rỗng thì không xoá gì', () => {
  const db = openDb(':memory:'); createSchema(db);
  const lib = createLibrary(db);
  seed(db, 'ot~x');
  assert.equal(lib.purgeByPrefixes([]), 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM comics').get().n, 1);
});

test('purgeOrphans xoá slug tiền tố lạ (kho đã gỡ), giữ TruyenQQ + truyện chữ + kho còn dùng', () => {
  const db = openDb(':memory:'); createSchema(db);
  const lib = createLibrary(db);
  ['nguyen-ton-3755', 'ot~dai-duong', 'ot~bien-hoang', 'nar~con-lai', 'nx~abc', 'tf~chu'].forEach(s => {
    db.prepare('INSERT INTO comics (slug,name,followed,followed_at) VALUES (?,?,1,?)').run(s, 'B', Date.now());
  });
  // Sau khi bỏ kho ot~: chỉ còn nar~, nx~ (và truyện chữ tf~)
  const removed = lib.purgeOrphans(['nar~', 'nx~', 'tf~']);
  assert.equal(removed, 2, 'xoá 2 bộ ot~ mồ côi');
  const left = db.prepare('SELECT slug FROM comics ORDER BY slug').all().map(r => r.slug);
  assert.deepEqual(left, ['nar~con-lai', 'nguyen-ton-3755', 'nx~abc', 'tf~chu']);
});

test('purgeOrphans không đụng gì khi mọi tiền tố đều còn dùng', () => {
  const db = openDb(':memory:'); createSchema(db);
  const lib = createLibrary(db);
  ['abc-123', 'nar~x', 'tf~y'].forEach(s =>
    db.prepare('INSERT INTO comics (slug,name,followed,followed_at) VALUES (?,?,1,?)').run(s, 'B', Date.now()));
  assert.equal(lib.purgeOrphans(['nar~', 'nx~', 'tf~']), 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM comics').get().n, 3);
});
