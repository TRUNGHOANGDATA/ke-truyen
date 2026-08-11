import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createTruyenQQSource, parseVnTime, chapterLabel } from '../src/source/truyenqq.js';

const fx = (n) => readFileSync(new URL(`./fixtures/qq/${n}`, import.meta.url), 'utf8');
const listHtml = fx('list.html');
const detailHtml = fx('detail.html');

/** fetch giả: khớp URL theo mảnh chuỗi, trả HTML fixture */
function fakeFetch(map) {
  return async (url) => {
    const key = Object.keys(map).find(k => String(url).includes(k));
    if (!key) return { ok: false, status: 404, text: async () => 'x'.repeat(300) };
    return { ok: true, status: 200, text: async () => map[key] };
  };
}
const src = (map, opts) => createTruyenQQSource({ fetchFn: fakeFetch(map), politeDelayMs: 0, retryDelayMs: 1, ...opts });

test('parseVnTime hiểu thời gian tương đối kiểu tiếng Việt', () => {
  const now = Date.parse('2026-08-12T10:00:00Z');
  assert.equal(parseVnTime('1 Phút Trước', now), '2026-08-12T09:59:00.000Z');
  assert.equal(parseVnTime('3 Giờ Trước', now), '2026-08-12T07:00:00.000Z');
  assert.equal(parseVnTime('2 Ngày Trước', now), '2026-08-10T10:00:00.000Z');
});

test('parseVnTime hiểu ngày dd/mm/yyyy', () => {
  assert.equal(parseVnTime('12/08/2026'), '2026-08-12T00:00:00.000Z');
});

test('parseVnTime trả null khi không đọc được', () => {
  assert.equal(parseVnTime(''), null);
  assert.equal(parseVnTime('hôm nào đó'), null);
});

test('chapterLabel lấy số chương', () => {
  assert.equal(chapterLabel('Chapter 110'), '110');
  assert.equal(chapterLabel('Chương 89.5'), '89.5');
});

test('home() đọc được danh sách truyện mới cập nhật', async () => {
  const s = src({ '/truyen-moi-cap-nhat': listHtml });
  const { items } = await s.home();
  assert.ok(items.length >= 20, `chỉ đọc được ${items.length} truyện`);
  const first = items[0];
  assert.ok(first.slug && !first.slug.includes('/'), `slug lạ: ${first.slug}`);
  assert.ok(first.name.length > 0);
  assert.match(first.thumbUrl, /^https?:\/\//);
  assert.ok(first.latestChapter, 'phải có số chương mới nhất');
  assert.ok(first.updatedAt, 'phải đọc được thời gian cập nhật');
});

test('list() có phân trang và trang 2 dùng đúng URL /trang-2', async () => {
  const seen = [];
  const s = createTruyenQQSource({
    politeDelayMs: 0,
    fetchFn: async (url) => { seen.push(String(url)); return { ok: true, status: 200, text: async () => listHtml }; },
  });
  const res = await s.list('truyen-moi', 2);
  assert.match(seen[0], /\/truyen-moi-cap-nhat\/trang-2$/);
  assert.equal(res.pagination.currentPage, 2);
  assert.equal(res.pagination.totalItemsPerPage, 42);
});

test('byCategory() gọi đúng đường dẫn thể loại kèm id', async () => {
  const seen = [];
  const s = createTruyenQQSource({
    politeDelayMs: 0,
    fetchFn: async (url) => { seen.push(String(url)); return { ok: true, status: 200, text: async () => listHtml }; },
  });
  await s.byCategory('action-26', 1);
  assert.match(seen[0], /\/the-loai\/action-26$/);
});

test('detail() đọc tên, trạng thái, thể loại và mục lục', async () => {
  const s = src({ '/truyen-tranh/nguyen-ton-3755': detailHtml });
  const d = await s.detail('nguyen-ton-3755');
  assert.equal(d.slug, 'nguyen-ton-3755');
  assert.ok(d.name.length > 0, 'phải có tên truyện');
  assert.ok(['ongoing', 'completed'].includes(d.status));
  assert.ok(d.categories.length >= 2, `thể loại: ${d.categories.join(', ')}`);
  assert.ok(d.chapters.length > 50, `chỉ đọc được ${d.chapters.length} chương`);
  assert.match(d.thumbUrl, /^https?:\/\//);
});

test('detail() xếp chương tăng dần và giữ URL đọc chương', async () => {
  const s = src({ '/truyen-tranh/nguyen-ton-3755': detailHtml });
  const d = await s.detail('nguyen-ton-3755');
  assert.equal(d.chapters[0].order, 0);
  assert.equal(d.chapters.at(-1).order, d.chapters.length - 1);
  const firstNum = parseFloat(d.chapters[0].name);
  const lastNum = parseFloat(d.chapters.at(-1).name);
  assert.ok(lastNum > firstNum, `phải tăng dần, nhận ${firstNum} -> ${lastNum}`);
  assert.match(d.chapters[0].apiUrl, /\/truyen-tranh\/.*-chap-/);
});

test('detail() bỏ "TruyenQQ" ở ô tác giả (nghĩa là không rõ tác giả)', async () => {
  const html = detailHtml.replace(
    /<li class="author row">[\s\S]*?<\/li>/,
    '<li class="author row"><p class="name col-xs-3">Tác giả</p><p class="col-xs-9"><a>TruyenQQ</a></p></li>'
  );
  const s = src({ '/truyen-tranh/x': html });
  const d = await s.detail('x');
  assert.equal(d.author, '');
});

test('chapter() lấy ảnh từ data-original', async () => {
  const page = `<html><body>
    <div id="page_0" class="page-chapter"><img class="lazy" src="https://i178.truyenvua.com/1/2/0.jpg?r=1"
         data-original="https://i178.truyenvua.com/1/2/0.jpg?r=1" data-cdn="https://i178.truyenvua.com/1/2/0.jpg"></div>
    <div id="page_1" class="page-chapter"><img class="lazy"
         data-original="https://i178.truyenvua.com/1/2/1.jpg?r=1"></div>
    ${'<!-- cho đủ dài -->'.repeat(30)}
  </body></html>`;
  const s = src({ '-chap-2': page });
  const { images } = await s.chapter('https://truyenqqko.com/truyen-tranh/abc-1-chap-2');
  assert.equal(images.length, 2);
  assert.equal(images[0].page, 0);
  assert.equal(images[0].url, 'https://i178.truyenvua.com/1/2/0.jpg?r=1');
  assert.equal(images[1].url, 'https://i178.truyenvua.com/1/2/1.jpg?r=1');
});

test('search() dùng POST tới endpoint AJAX', async () => {
  let method = '', body = '';
  const frag = '<li><a href="https://truyenqqko.com/truyen-tranh/nguyen-ton-3755">' +
    '<div class="search_avatar"><img src="https://i.hinhhinh.com/x.jpg" alt="Nguyên Tôn"></div>' +
    '<h3>Nguyên Tôn</h3></a></li>' + '<!-- pad -->'.repeat(40);
  const s = createTruyenQQSource({
    politeDelayMs: 0,
    fetchFn: async (url, init) => { method = init.method; body = init.body; return { ok: true, status: 200, text: async () => frag }; },
  });
  const { items } = await s.search('nguyên tôn');
  assert.equal(method, 'POST');
  assert.match(body, /search=/);
  assert.equal(items[0].slug, 'nguyen-ton-3755');
  assert.equal(items[0].name, 'Nguyên Tôn');
});

test('thử lại rồi báo lỗi khi trang liên tục lỗi', async () => {
  let calls = 0;
  const s = createTruyenQQSource({
    politeDelayMs: 0, retryDelayMs: 1, retries: 2,
    fetchFn: async () => { calls++; throw new Error('mạng lỗi'); },
  });
  await assert.rejects(() => s.home());
  assert.equal(calls, 3);
});

test('giữ khoảng nghỉ giữa các request để không đập nguồn', async () => {
  const stamps = [];
  const s = createTruyenQQSource({
    politeDelayMs: 60,
    fetchFn: async () => { stamps.push(Date.now()); return { ok: true, status: 200, text: async () => listHtml }; },
  });
  await s.home(); await s.home();
  assert.ok(stamps[1] - stamps[0] >= 50, `chỉ cách nhau ${stamps[1] - stamps[0]}ms`);
});

test('byCategory() sắp truyện mới cập nhật lên trước', async () => {
  // Trang thể loại của TruyenQQ không sắp theo thời gian, adapter phải tự sắp
  const s = src({ '/the-loai/action-26': listHtml });
  const { items } = await s.byCategory('action-26', 1);
  const stamps = items.map(i => Date.parse(i.updatedAt) || 0).filter(Boolean);
  const sorted = [...stamps].sort((a, b) => b - a);
  assert.deepEqual(stamps, sorted, 'phải giảm dần theo thời gian cập nhật');
});
