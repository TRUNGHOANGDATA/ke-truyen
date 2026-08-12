import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTruyenQQSource } from '../src/source/truyenqq.js';

const PAGE = '<html><body>' +
  '<div class="list_grid"><li><a class="book_avatar" href="/truyen-tranh/abc-123"></a>' +
  '<div class="book_name"><a>Abc</a></div></li></div>' +
  'x'.repeat(300) + '</body></html>';

test('domain cũ chết -> reprobe ra domain mới -> thử lại thành công, và ghi nhớ base mới', async () => {
  const OLD = 'https://old.com', NEW = 'https://new.com';
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.startsWith(OLD)) return { ok: false, status: 502, async text() { return ''; } };
    return { ok: true, status: 200, async text() { return PAGE; } };
  };
  let reprobes = 0;
  const src = createTruyenQQSource({
    base: OLD, fetchFn, retries: 0, retryDelayMs: 1, politeDelayMs: 0,
    reprobe: async () => { reprobes++; return NEW; },
  });

  const res = await src.home();
  assert.ok(Array.isArray(res.items), 'vẫn lấy được truyện sau khi nhảy domain');
  assert.equal(reprobes, 1, 'chỉ dò lại một lần');
  assert.ok(calls.some(u => u.startsWith(OLD)), 'có thử domain cũ trước');
  assert.ok(calls.some(u => u.startsWith(NEW)), 'rồi thử lại trên domain mới');
  assert.equal(src.getBase(), NEW, 'base đã chuyển sang domain mới');
});

test('không có reprobe thì lỗi domain ném ra như cũ', async () => {
  const src = createTruyenQQSource({
    base: 'https://old.com',
    fetchFn: async () => ({ ok: false, status: 502, async text() { return ''; } }),
    retries: 0, retryDelayMs: 1, politeDelayMs: 0,
  });
  await assert.rejects(() => src.home());
});

test('setBase đổi domain thủ công', () => {
  const src = createTruyenQQSource({ base: 'https://a.com' });
  src.setBase('https://b.com/');
  assert.equal(src.getBase(), 'https://b.com');
});
