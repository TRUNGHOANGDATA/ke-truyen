import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNetTruyenSource, slugFromHref, parseChapterName } from '../src/source/nettruyen.js';

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
      if (url.includes(frag)) return { ok: true, status: 200, async text() { return html; } };
    }
    return { ok: false, status: 404, async text() { return ''; } };
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

test('search() trả rỗng (NetTruyen không có tìm server-side đáng tin)', async () => {
  const { items } = await src({}).search('bất kỳ');
  assert.deepEqual(items, []);
});
