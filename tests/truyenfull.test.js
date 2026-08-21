import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTruyenfullSource, slugFromHref, parseChapterName, upsizeCover } from '../src/source/truyenfull.js';

// --- HTML tối giản nhưng đúng cấu trúc thật của truyenfull ---
const LIST = `<html><body><div class="list-truyen">
  <div class="row"><h3 class="truyen-title"><a href="https://truyenfull.live/dai-chua-te/">Đại Chúa Tể</a></h3>
    <div class="text-info"><a>Chương 1563</a></div></div>
  <div class="row"><h3 class="truyen-title"><a href="https://truyenfull.live/vo-luyen-dinh-phong/">Võ Luyện Đỉnh Phong</a></h3>
    <div class="text-info"><a>Chương 100</a></div></div>
</div></body></html>`;

const DETAIL = `<html><body>
  <h3 itemprop="name">Đại Chúa Tể</h3>
  <a itemprop="author">Thiên Tàm Thổ Đậu</a>
  <img itemprop="image" src="https://static.truyenfull.live/cover/dai-chua-te.jpg">
  <div itemprop="description">Đại thiên thế giới, nơi các vị diện giao nhau.</div>
  <a itemprop="genre">Tiên Hiệp</a><a itemprop="genre">Tiên Hiệp</a><a itemprop="genre">Huyền Huyễn</a>
  <div class="info"><div>Tác giả:Thiên Tàm Thổ Đậu</div><div>Trạng thái:Full</div></div>
  <input id="total-page" type="hidden" value="1">
  <ul id="list-chapter">
    <li><a href="https://truyenfull.live/dai-chua-te/chuong-1/" title="Chương 1: Bắc Linh viện">Chương 1</a></li>
    <li><a href="https://truyenfull.live/dai-chua-te/chuong-2/" title="Chương 2: Thiếu niên">Chương 2</a></li>
  </ul>
</body></html>`;

const CHAP = `<html><body>
  <a class="chapter-title">Chương 1: Bắc Linh viện</a>
  <div id="chapter-c">Đoạn một.<br><br>Đoạn hai.<script>bẩn()</script><div class="ads">QUẢNG CÁO</div><br>Đoạn ba.</div>
</body></html>`;

const SEARCH = `<html><head><title>Tìm kiếm</title></head><body><div class="col-truyen-main">
  <div class="row"><h3 class="truyen-title"><a href="https://truyenfull.live/dai-chua-te/">Đại Chúa Tể</a></h3></div>
  <!-- phần đệm cho đủ dài, mô phỏng khung trang thật của truyenfull với nhiều markup xung quanh kết quả -->
</div></body></html>`;

function fakeFetch(map) {
  return async (url) => {
    for (const [frag, html] of Object.entries(map)) {
      if (url.includes(frag)) return { ok: true, status: 200, async text() { return html; } };
    }
    return { ok: false, status: 404, async text() { return ''; } };
  };
}

function src(map) {
  return createTruyenfullSource({ fetchFn: fakeFetch(map), politeDelayMs: 0, retryDelayMs: 0 });
}

test('slugFromHref lấy đúng slug, bỏ trang chức năng', () => {
  assert.equal(slugFromHref('https://truyenfull.live/dai-chua-te/'), 'dai-chua-te');
  assert.equal(slugFromHref('https://truyenfull.live/the-loai/tien-hiep/'), '');
  assert.equal(slugFromHref('https://truyenfull.live/danh-sach/truyen-moi/'), '');
});

test('parseChapterName tách số chương và tựa đề', () => {
  assert.deepEqual(parseChapterName('Chương 12: Tựa đề'), { name: '12', title: 'Tựa đề' });
  assert.deepEqual(parseChapterName('Chương 8.5'), { name: '8.5', title: '' });
});

test('home() trả danh sách truyện, mỗi item kind=novel', async () => {
  const s = src({ '/danh-sach/truyen-moi/': LIST });
  const { items } = await s.home();
  assert.equal(items.length, 2);
  assert.equal(items[0].slug, 'dai-chua-te');
  assert.equal(items[0].name, 'Đại Chúa Tể');
  assert.equal(items[0].kind, 'novel');
});

test('search() dùng endpoint tim-kiem', async () => {
  const s = src({ '/tim-kiem/': SEARCH });
  const { items } = await s.search('đại chúa tể');
  assert.equal(items.length, 1);
  assert.equal(items[0].slug, 'dai-chua-te');
});

test('detail() đọc tên/tác giả/status, khử trùng thể loại, gom mục lục', async () => {
  const s = src({ '/dai-chua-te/': DETAIL });
  const d = await s.detail('dai-chua-te');
  assert.equal(d.kind, 'novel');
  assert.equal(d.name, 'Đại Chúa Tể');
  assert.equal(d.author, 'Thiên Tàm Thổ Đậu');
  assert.equal(d.status, 'completed');                 // "Full"
  assert.deepEqual(d.categories, ['Tiên Hiệp', 'Huyền Huyễn']);  // đã khử trùng
  assert.equal(d.chapters.length, 2);
  assert.equal(d.chapters[0].name, '1');
  assert.equal(d.chapters[0].title, 'Bắc Linh viện');
  assert.equal(d.chapters[0].order, 0);
  assert.ok(d.thumbUrl.includes('static.truyenfull.live'));
});

test('chapter() trả các đoạn văn, bỏ script và quảng cáo', async () => {
  const s = src({ '/chuong-1/': CHAP });
  const ch = await s.chapter('https://truyenfull.live/dai-chua-te/chuong-1/');
  assert.equal(ch.title, 'Chương 1: Bắc Linh viện');
  assert.deepEqual(ch.paragraphs, ['Đoạn một.', 'Đoạn hai.', 'Đoạn ba.']);
  assert.ok(!ch.paragraphs.join(' ').includes('QUẢNG CÁO'));
  assert.ok(!ch.paragraphs.join(' ').includes('bẩn'));
});

test('upsizeCover nâng thumbnail Google, giữ nguyên host khác', () => {
  assert.equal(upsizeCover('https://lh3.googleusercontent.com/d/ABC=w60-h85-c'),
    'https://lh3.googleusercontent.com/d/ABC=w300-h420');
  assert.equal(upsizeCover('https://lh3.googleusercontent.com/pw/XYZ=w60-h85-c'),
    'https://lh3.googleusercontent.com/pw/XYZ=w300-h420');
  assert.equal(upsizeCover('https://lh3.googleusercontent.com/d/ABC'),
    'https://lh3.googleusercontent.com/d/ABC=w300-h420');
  // host khác giữ nguyên
  assert.equal(upsizeCover('https://static.truyenfull.live/cover/o/x.jpg'),
    'https://static.truyenfull.live/cover/o/x.jpg');
});

test('detail/list trả bìa đã nâng cỡ cho ảnh Google', async () => {
  const listG = LIST.replace('class="row"><h3', 'class="row"><span data-image="https://lh3.googleusercontent.com/d/ABC=w60-h85-c"></span><h3');
  const s = src({ '/danh-sach/truyen-moi/': listG });
  const { items } = await s.home();
  assert.ok(items[0].thumbUrl.endsWith('=w300-h420'), 'bìa danh sách phải được nâng cỡ');
});
