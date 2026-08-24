import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createKvCache } from '../src/services/kv-cache.js';
import { createAltSources } from '../src/services/alt-sources.js';

const NAME = 'Tứ Đại Danh Bổ';

function setup({ counters = {} } = {}) {
  const db = openDb(':memory:'); createSchema(db);
  const kv = createKvCache(db, { prefix: 'kv:' });
  const site = (id, label, prefix, slug) => ({
    id, label, prefix,
    src: {
      async search() {
        counters[id] = (counters[id] || 0) + 1;
        return { items: slug ? [{ name: 'TỨ ĐẠI DANH BỔ', slug }] : [] };
      },
    },
  });
  const manager = {
    comicSources: () => [
      site('truyenqq', 'TruyenQQ', '', 'tu-dai-danh-bo-1463'),
      site('nettruyen', 'NetTruyen', 'ot~', 'tu-dai-danh-bo'),
      site('ba', 'NetTruyen 3', 'nx~', null),        // nguồn này không có bộ đó
    ],
  };
  return { alt: createAltSources({ manager, kv }), counters, kv, manager };
}

test('list() trả nguồn đang đọc kèm cờ current, bỏ nguồn không có bộ', async () => {
  const { alt } = setup();
  const out = await alt.list('tu-dai-danh-bo-1463', NAME, '5');
  assert.deepEqual(out.map(s => [s.n, s.label, s.current, s.url]), [
    [1, 'TruyenQQ', true, '/doc/tu-dai-danh-bo-1463/5'],
    [2, 'NetTruyen', false, '/doc/ot~tu-dai-danh-bo/5'],
  ]);
});

test('cached() KHÔNG chạm nguồn: chưa ấm trả null, ấm rồi trả danh sách', async () => {
  const { alt, counters } = setup();
  assert.equal(alt.cached('tu-dai-danh-bo-1463', NAME, '5'), null);
  assert.deepEqual(counters, {}, 'chưa ấm thì không được gọi search');

  await alt.list('tu-dai-danh-bo-1463', NAME, '5');
  const truoc = { ...counters };
  const out = alt.cached('tu-dai-danh-bo-1463', NAME, '9');
  assert.equal(out.length, 2);
  assert.deepEqual(counters, truoc, 'đọc cache không được gọi lại search');
});

test('số chương ghép lúc dựng link, không bị dính chương đã cache', async () => {
  const { alt } = setup();
  await alt.list('tu-dai-danh-bo-1463', NAME, '1');
  assert.equal(alt.cached('tu-dai-danh-bo-1463', NAME, '42')[1].url, '/doc/ot~tu-dai-danh-bo/42');
});

test('đọc từ kho khác thì cờ current chuyển sang đúng kho đó', async () => {
  const { alt } = setup();
  const out = await alt.list('ot~tu-dai-danh-bo', NAME, '5');
  assert.deepEqual(out.map(s => [s.label, s.current]), [['TruyenQQ', false], ['NetTruyen', true]]);
});

test('warm() làm ấm ngầm để cached() có ngay sau đó', async () => {
  const { alt } = setup();
  alt.warm(NAME);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(alt.cached('tu-dai-danh-bo-1463', NAME, '1'), 'warm xong thì cached phải có');
});

test('warm() không tra lại khi đã có trong cache', async () => {
  const { alt, counters } = setup();
  await alt.list('tu-dai-danh-bo-1463', NAME, '1');
  const truoc = { ...counters };
  alt.warm(NAME);
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(counters, truoc);
});

test('nguồn ném lỗi thì bỏ qua nguồn đó, không làm chết cả phép tra', async () => {
  const db = openDb(':memory:'); createSchema(db);
  const manager = { comicSources: () => [
    { id: 'a', label: 'A', prefix: '', src: { async search() { throw new Error('chết'); } } },
    { id: 'b', label: 'B', prefix: 'b~', src: { async search() { return { items: [{ name: NAME, slug: 'x' }] }; } } },
  ]};
  const alt = createAltSources({ manager, kv: createKvCache(db) });
  const out = await alt.list('nao-do', NAME, '3');
  // nguồn A vẫn có mặt vì đang đọc ở đó (slug biết sẵn), nguồn B tìm thấy
  assert.deepEqual(out.map(s => s.label), ['A', 'B']);
});

test('không có nguồn nào / thiếu tên thì trả rỗng, không nổ', async () => {
  const db = openDb(':memory:'); createSchema(db);
  const alt = createAltSources({ manager: { comicSources: () => [] }, kv: createKvCache(db) });
  assert.deepEqual(await alt.list('x', 'Tên', '1'), []);
  assert.equal(alt.cached('x', 'Tên', '1'), null);
  assert.doesNotThrow(() => alt.warm(''));
});
