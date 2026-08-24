import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImageDoctor } from '../src/services/image-doctor.js';

const IMG = 'https://images.truyenonline.cc/u/chapter_19/page_1.jpg';
const source = {
  async detail() { return { name: 'Bộ Thử', chapters: [{ name: '19', apiUrl: 'https://x/chuong-19' }] }; },
  async chapter() { return { images: [{ page: 0, url: IMG }, { page: 1, url: IMG + '?2' }] }; },
};
const base = {
  source,
  imageHosts: { allowed: () => true },
  refererFor: (u) => new URL(u).origin + '/',
  altReferer: () => ['https://nguon1.com/', 'https://nguon2.com/'],
  now: (() => { let t = 0; return () => (t += 10) - 10; })(),
};
const res = (o) => ({ ok: false, status: 404, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0), ...o });
const okRes = () => ({ ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array(1234).buffer });

test('lấy được ảnh: dừng ngay và nói rõ referer nào ăn', async () => {
  const d = createImageDoctor({ ...base, fetchFn: async (_u, o) =>
    (o.headers.Referer === 'https://nguon2.com/' ? okRes() : res()) });
  const r = await d.diagnoseChapter('bo-thu', '19');
  assert.equal(r.comic, 'Bộ Thử');
  assert.equal(r.chapter, '19');
  assert.equal(r.imageCount, 2);
  assert.ok(r.attempts.at(-1).ok);
  assert.match(r.verdict, /nguon2\.com/);
  assert.match(r.verdict, /1234 byte/);
});

test('không host nào phản hồi -> kết luận CDN chết, phải đổi nguồn', async () => {
  const d = createImageDoctor({ ...base, fetchFn: async () => {
    throw Object.assign(new Error('t'), { name: 'AbortError' });
  } });
  const r = await d.diagnoseUrl(IMG);
  assert.ok(r.attempts.every(a => !a.ok));
  assert.ok(r.attempts.every(a => /Quá hạn/.test(a.error)));
  assert.match(r.verdict, /CDN của nguồn chết|đổi sang nguồn khác/);
});

test('host sống nhưng từ chối hết -> kết luận chặn hotlink, có nêu mã', async () => {
  const d = createImageDoctor({ ...base, fetchFn: async () => res({ status: 403 }) });
  const r = await d.diagnoseUrl(IMG);
  assert.match(r.verdict, /chặn hotlink/);
  assert.match(r.verdict, /403/);
});

test('thử đủ các host bản sao, không chỉ host trong URL', async () => {
  const hosts = new Set();
  const d = createImageDoctor({ ...base, fetchFn: async (u) => { hosts.add(new URL(u).hostname); return res(); } });
  await d.diagnoseUrl(IMG);
  assert.deepEqual([...hosts].sort(), ['images.truyenonline.cc', 'otruyencdn.com', 'sv1.otruyencdn.com']);
});

test('báo khi host ảnh chưa được proxy cho qua', async () => {
  const d = createImageDoctor({ ...base, imageHosts: { allowed: () => false }, fetchFn: async () => res() });
  const r = await d.diagnoseUrl(IMG);
  assert.equal(r.allowed, false);
});

test('nguồn lỗi thì báo lỗi rõ ràng chứ không nổ', async () => {
  const d = createImageDoctor({ ...base, source: { async detail() { throw new Error('nguồn chết'); } },
    fetchFn: async () => okRes() });
  const r = await d.diagnoseChapter('x', '1');
  assert.match(r.error, /Không mở được truyện.*nguồn chết/);
});

test('chương không có ảnh nào thì nói thẳng', async () => {
  const d = createImageDoctor({ ...base,
    source: { ...source, async chapter() { return { images: [] }; } }, fetchFn: async () => okRes() });
  const r = await d.diagnoseChapter('x', '19');
  assert.match(r.error, /không trả về ảnh nào/);
});
