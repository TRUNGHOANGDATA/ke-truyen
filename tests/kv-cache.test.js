import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createKvCache } from '../src/services/kv-cache.js';

function setup(opts) {
  const db = openDb(':memory:'); createSchema(db);
  return { db, kv: createKvCache(db, opts) };
}

test('chưa có thì trả undefined; set rồi thì lấy lại đúng giá trị', () => {
  const { kv } = setup();
  assert.equal(kv.get('a'), undefined);
  kv.set('a', { x: [1, 2] }, 1000);
  assert.deepEqual(kv.get('a'), { x: [1, 2] });
});

test('hết hạn thì coi như chưa có', () => {
  const { kv } = setup();
  kv.set('a', 'cũ', -1);                       // hết hạn ngay
  assert.equal(kv.get('a'), undefined);
});

test('wrap chỉ gọi hàm một lần rồi dùng lại kết quả', async () => {
  const { kv } = setup();
  let goi = 0;
  const fn = async () => { goi++; return ['x']; };
  assert.deepEqual(await kv.wrap('k', 1000, fn), ['x']);
  assert.deepEqual(await kv.wrap('k', 1000, fn), ['x']);
  assert.equal(goi, 1);
});

test('wrap KHÔNG cache khi hàm ném lỗi (lần sau phải thử lại)', async () => {
  const { kv } = setup();
  let goi = 0;
  const hong = async () => { goi++; throw new Error('nguồn chết'); };
  await assert.rejects(() => kv.wrap('k', 1000, hong));
  await assert.rejects(() => kv.wrap('k', 1000, hong));
  assert.equal(goi, 2);
});

test('wrap cache được cả giá trị rỗng (mảng rỗng vẫn là câu trả lời)', async () => {
  const { kv } = setup();
  let goi = 0;
  const fn = async () => { goi++; return []; };
  await kv.wrap('k', 1000, fn);
  await kv.wrap('k', 1000, fn);
  assert.equal(goi, 1, 'mảng rỗng phải được nhớ, không tra lại');
});

test('prefix tách không gian khoá giữa các nơi dùng chung bảng', () => {
  const db = openDb(':memory:'); createSchema(db);
  const a = createKvCache(db, { prefix: 'a:' });
  const b = createKvCache(db, { prefix: 'b:' });
  a.set('k', 1, 1000);
  assert.equal(a.get('k'), 1);
  assert.equal(b.get('k'), undefined);
});
