import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNetTruyenSource, slugFromHref, parseChapterName, isChapterHref } from '../src/source/nettruyen.js';

const LIST = `<html><body><div class="items">
  <div class="item"><figure><a href="https://nettruyen.id/truyen-tranh/vo-than-hoang-kim"></a>
    <img data-src="https://nettruyen-api.clubc.org/storage/images/thumbnails/vo-than-hoang-kim.webp" alt="Võ Thần Hoàng Kim">
    <figcaption><h3><a href="https://nettruyen.id/truyen-tranh/vo-than-hoang-kim">Võ Thần Hoàng Kim</a></h3></figcaption>
    <ul><li><a>Chapter 12</a></li></ul></div>
  <div class="item"><figure><a href="https://nettruyen.id/truyen-tranh/nguyen-ton"></a>
    <img data-src="x.webp" alt="Nguyên Tôn"><figcaption><h3><a href="https://nettruyen.id/truyen-tranh/nguyen-ton">Nguyên Tôn</a></h3></figcaption>
    <ul><li><a>Chapter 300</a></li></ul></div>
</div></body></html>`;

const DETAIL = `<html><body>
  <h1 class="title-detail">Đại Đường Song Long Truyện</h1>
  <div class="col-image"><img data-src="https://nettruyen-api.clubc.org/storage/images/thumbnails/dai-duong-song-long-truyen.webp"></div>
  <ul class="list-info">
    <li class="author"><p class="name">Tác giả</p><p class="col-xs-8">Huỳnh Dị</p></li>
    <li class="status"><p class="name">Tình trạng</p><p class="col-xs-8">Hoàn thành</p></li>
    <li class="kind"><p class="name">Thể loại</p><p class="col-xs-8"><a>Action</a> - <a>Adventure</a> - <a>Manhua</a></p></li>
  </ul>
  <div class="detail-content"><p>Hai tên ăn mày Khấu Trọng và Từ Tử Lăng.</p></div>
  <div class="list-chapter"><ul>
    <li><a href="https://nettruyen.id/truyen-tranh/dai-duong-song-long-truyen/chuong-2">Chapter 2</a></li>
    <li><a href="https://nettruyen.id/truyen-tranh/dai-duong-song-long-truyen/chuong-1">Chapter 1: Mở đầu</a></li>
  </ul></div>
</body></html>`;

const CHAP = `<html><body><div class="reading-detail">
  <div class="page-chapter"><img data-src="https://images.truyenonline.cc/uploads/x/chapter_1/page_1.jpg"></div>
  <div class="page-chapter"><img data-src="https://images.truyenonline.cc/uploads/x/chapter_1/page_2.jpg"></div>
</div><!-- dem cho du dai xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx --></body></html>`;

function fakeFetch(map) {
  return async (url) => {
    for (const [frag, html] of Object.entries(map)) {
      if (url.includes(frag)) return { ok: true, status: 200, async text() { return html; }, async json() { return JSON.parse(html); } };
    }
    return { ok: false, status: 404, async text() { return ''; }, async json() { return {}; } };
  };
}
const src = (map) => createNetTruyenSource({ fetchFn: fakeFetch(map), politeDelayMs: 0, retryDelayMs: 0 });

test('slugFromHref lấy slug, bỏ phần /chuong-', () => {
  assert.equal(slugFromHref('https://nettruyen.id/truyen-tranh/dai-chua-te'), 'dai-chua-te');
  assert.equal(slugFromHref('https://nettruyen.id/truyen-tranh/dai-chua-te/chuong-15'), 'dai-chua-te');
});

test('parseChapterName tách "Chapter 252: END"', () => {
  assert.deepEqual(parseChapterName('Chapter 252: END'), { name: '252', title: 'END' });
  assert.deepEqual(parseChapterName('Chương 8.5'), { name: '8.5', title: '' });
});

test('home() đọc thẻ truyện', async () => {
  const { items } = await src({ 'nettruyen.id/': LIST }).home();
  assert.equal(items.length, 2);
  assert.equal(items[0].slug, 'vo-than-hoang-kim');
  assert.equal(items[0].name, 'Võ Thần Hoàng Kim');
  assert.equal(items[0].latestChapter, '12');
  assert.ok(items[0].thumbUrl.includes('nettruyen-api.clubc.org'));
});

test('detail() đọc tên/tác giả/trạng thái/thể loại và mục lục tăng dần', async () => {
  const d = await src({ '/truyen-tranh/dai-duong-song-long-truyen': DETAIL }).detail('dai-duong-song-long-truyen');
  assert.equal(d.name, 'Đại Đường Song Long Truyện');
  assert.equal(d.author, 'Huỳnh Dị');
  assert.equal(d.status, 'completed');
  assert.deepEqual(d.categories, ['Action', 'Adventure', 'Manhua']);
  assert.equal(d.chapters.length, 2);
  assert.equal(d.chapters[0].name, '1');            // đảo tăng dần
  assert.equal(d.chapters[0].title, 'Mở đầu');
  assert.equal(d.chapters[0].order, 0);
  assert.ok(d.chapters[0].apiUrl.includes('nettruyen.id'));
});

test('chapter() trả danh sách ảnh theo thứ tự', async () => {
  const { images } = await src({ '/chuong-1': CHAP }).chapter('https://nettruyen.id/truyen-tranh/x/chuong-1');
  assert.equal(images.length, 2);
  assert.equal(images[0].page, 0);
  assert.ok(images[0].url.includes('images.truyenonline.cc'));
  assert.ok(images[1].url.endsWith('page_2.jpg'));
});

test('search() dùng API JSON (param keyword), map slug + bìa', async () => {
  const API = JSON.stringify({ status: 'success', comics: [
    { slug: 'nguyen-ton', name: 'Nguyên Tôn', thumbnail: '/storage/images/thumbnails/nguyen-ton.webp',
      status: 'ongoing', last_chapter: { name: 'Chapter 300' } },
  ]});
  const s = createNetTruyenSource({ fetchFn: fakeFetch({ '/api/comics/search': API }), politeDelayMs: 0, retryDelayMs: 0 });
  const { items } = await s.search('nguyen ton');
  assert.equal(items.length, 1);
  assert.equal(items[0].slug, 'nguyen-ton');
  assert.equal(items[0].name, 'Nguyên Tôn');
  assert.ok(items[0].thumbUrl.includes('nettruyen-api.clubc.org'));
  assert.equal(items[0].latestChapter, '300');
});

test('search() trả rỗng khi API lỗi (không làm chết ô tìm)', async () => {
  const { items } = await src({}).search('bất kỳ');   // fakeFetch trả 404
  assert.deepEqual(items, []);
});

/* ---------- Các site cùng khung nhưng không có API JSON / cắt bớt mục lục ---------- */

test('isChapterHref chỉ nhận link chương thật', () => {
  assert.equal(isChapterHref('/truyen-tranh/abc/chuong-12/9988'), true);
  assert.equal(isChapterHref('https://x.com/truyen-tranh/abc/chapter-3'), true);
  assert.equal(isChapterHref('#'), false);              // nút "Xem thêm"
  assert.equal(isChapterHref('/truyen-tranh/abc'), false);
  assert.equal(isChapterHref(undefined), false);
});

// Trang chi tiết chỉ nhả 2 chương mới nhất + nút "Xem thêm" (href="#"), kèm
// data-id của truyện để gọi được mục lục đầy đủ.
const DETAIL_CUT = `<html><body>
  <h1 class="title-detail">Tứ Đại Danh Bổ</h1>
  <div class="col-image"><img data-src="https://cdn2.example.com/thumb/tu-dai-danh-bo.jpg"></div>
  <ul class="list-info"><li class="status"><p class="col-xs-8">Đang tiến hành</p></li></ul>
  <div class="detail-content"><p>Bốn danh bổ dưới trướng Gia Cát tiên sinh.</p></div>
  <div id="item-detail" data-id="1463"></div>
  <nav><ul class="list-chapter">
    <li class="row"><div class="chapter"><a href="/truyen-tranh/tu-dai-danh-bo/chuong-371/355573" data-id="355573">Chapter 371</a></div></li>
    <li class="row"><div class="chapter"><a href="/truyen-tranh/tu-dai-danh-bo/chuong-370/355575" data-id="355575">Chapter 370</a></div></li>
  </ul><a class="view-more hidden" href="#">Xem thêm</a></nav>
</body></html>`;

const FULL_LIST = JSON.stringify({ success: true, chapters: [
  { chapterId: 355573, name: 'Chapter 371', url: '/truyen-tranh/tu-dai-danh-bo/chuong-371/355573' },
  { chapterId: 355575, name: 'Chapter 370', url: '/truyen-tranh/tu-dai-danh-bo/chuong-370/355575' },
  { chapterId: 355576, name: 'Chapter 369', url: '/truyen-tranh/tu-dai-danh-bo/chuong-369/355576' },
  { chapterId: 355999, name: 'Chapter 1: Mở đầu', url: '/truyen-tranh/tu-dai-danh-bo/chuong-1/355999' },
]});

const noApi = (map) => createNetTruyenSource({
  base: 'https://nettruyenar.com', apiBase: '', fetchFn: fakeFetch(map), politeDelayMs: 0, retryDelayMs: 0,
});

test('detail() bỏ nút "Xem thêm" khỏi mục lục', async () => {
  const d = await noApi({ '/truyen-tranh/tu-dai-danh-bo': DETAIL_CUT }).detail('tu-dai-danh-bo');
  assert.ok(d.chapters.every(c => c.name !== 'Xem thêm'));
  assert.deepEqual(d.chapters.map(c => c.name), ['370', '371']);
});

test('detail() lấy mục lục ĐẦY ĐỦ qua ProcessChapterList khi trang bị cắt', async () => {
  const d = await noApi({
    'ProcessChapterList': FULL_LIST,                 // khớp trước, tránh dính nhánh dưới
    '/truyen-tranh/tu-dai-danh-bo': DETAIL_CUT,
  }).detail('tu-dai-danh-bo');
  assert.equal(d.chapters.length, 4);                // 4 > 2 -> dùng bản đầy đủ
  assert.equal(d.chapters[0].name, '1');             // tăng dần
  assert.equal(d.chapters[0].title, 'Mở đầu');
  assert.equal(d.chapters[0].order, 0);
  assert.equal(d.chapters.at(-1).name, '371');
  assert.ok(d.chapters[0].apiUrl.startsWith('https://nettruyenar.com/'));
});

test('ProcessChapterList lỗi thì vẫn dùng mục lục có trong trang', async () => {
  const d = await noApi({ '/truyen-tranh/tu-dai-danh-bo': DETAIL_CUT }).detail('tu-dai-danh-bo');
  assert.deepEqual(d.chapters.map(c => c.name), ['370', '371']);
});

test('site không có API JSON thì tìm kiếm bằng trang /tim-truyen', async () => {
  let asked = '';
  const s = createNetTruyenSource({
    base: 'https://nettruyenar.com', apiBase: '', politeDelayMs: 0, retryDelayMs: 0,
    fetchFn: async (url) => { asked = url; return { ok: true, status: 200, async text() { return LIST; } }; },
  });
  const { items } = await s.search('vo than');
  assert.ok(asked.includes('/tim-truyen?keyword=vo%20than'), 'phải gọi /tim-truyen?keyword=, thấy: ' + asked);
  assert.deepEqual(items.map(i => i.slug), ['vo-than-hoang-kim', 'nguyen-ton']);
});
