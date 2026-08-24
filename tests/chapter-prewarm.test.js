import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChapterPrewarm } from '../src/services/chapter-prewarm.js';

function setup({ cached = new Set(), failOn = new Set() } = {}) {
  const store = new Map();
  const fetched = [];
  const cache = {
    get: (u) => (cached.has(u) || store.has(u) ? { buf: Buffer.from('x') } : undefined),
    put: (u, buf, ct) => store.set(u, { buf, ct }),
  };
  const fetcher = {
    async get(url, { lane } = {}) {
      fetched.push({ url, lane });
      if (failOn.has(url)) throw Object.assign(new Error('busy'), { busy: true });
      return { buf: Buffer.from('anh'), contentType: 'image/jpeg' };
    },
  };
  return { pw: createChapterPrewarm({ cache, fetcher }), fetched, store };
}

test('ủ tuần tự từng ảnh vào cache đĩa, đi làn nền', async () => {
  const { pw, fetched, store } = setup();
  await pw.queue('bo/19', ['u1', 'u2', 'u3']);
  assert.deepEqual(fetched.map(f => f.url), ['u1', 'u2', 'u3']);
  assert.ok(fetched.every(f => f.lane === 'bg'), 'phải đi làn bg, không giành chỗ ảnh đang nhìn');
  assert.equal(store.size, 3);
});

test('ảnh đã có trong cache thì bỏ qua, không gọi CDN', async () => {
  const { pw, fetched } = setup({ cached: new Set(['u2']) });
  await pw.queue('bo/19', ['u1', 'u2', 'u3']);
  assert.deepEqual(fetched.map(f => f.url), ['u1', 'u3']);
});

test('cùng một chương gọi hai lần chỉ ủ một lần', async () => {
  const { pw, fetched } = setup();
  await pw.queue('bo/19', ['u1']);
  await pw.queue('bo/19', ['u1']);
  assert.equal(fetched.length, 1);
});

test('một ảnh lỗi/bận không làm gãy phần còn lại lẫn chương sau', async () => {
  const { pw, fetched, store } = setup({ failOn: new Set(['u2']) });
  await pw.queue('bo/19', ['u1', 'u2', 'u3']);
  await pw.queue('bo/20', ['v1']);
  assert.deepEqual(fetched.map(f => f.url), ['u1', 'u2', 'u3', 'v1']);
  assert.equal(store.size, 3, 'u2 lỗi thì thiếu đúng 1 ảnh, không thiếu cả dây');
});

test('hai chương xếp hàng chạy TUẦN TỰ, không chen nhau', async () => {
  const thuTu = [];
  const cache = { get: () => undefined, put: () => {} };
  const fetcher = { async get(url) { thuTu.push(url); await new Promise(r => setTimeout(r, 5)); return null; } };
  const pw = createChapterPrewarm({ cache, fetcher });
  const a = pw.queue('a', ['a1', 'a2']);
  const b = pw.queue('b', ['b1']);
  await Promise.all([a, b]);
  assert.deepEqual(thuTu, ['a1', 'a2', 'b1']);
});

test('không có fetcher thì im lặng bỏ qua (không nổ route)', async () => {
  const pw = createChapterPrewarm({ cache: { get: () => undefined, put: () => {} } });
  assert.doesNotThrow(() => pw.queue('x', ['u1']));
});
