import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTopTruyenSource, parseComicHref, splitSlug, chapterLabel } from '../src/source/toptruyen.js';

const B = 'https://www.toptruyenzonee.com';

const LIST = `<html><body><div class="item-manga"><div class="row">
  <div class="item"><div class="clearfix">
    <div class="image-item"><a href="${B}/truyen-tranh/yeu-than-ky/673" title="Yêu Thần Ký">
      <img src="https://s2.anhvip.xyz/comics/yeu-than-ky.jpg" alt="Yêu Thần Ký" class="image-item lazy"></a></div>
    <div class="caption"><h3><a href="${B}/truyen-tranh/yeu-than-ky/673" class="title-manga" data-id="673">Yêu Thần Ký</a></h3>
      <ul><li class="chapter-detail"><a href="${B}/truyen-tranh/yeu-than-ky/chapter-705/3598612">Chapter 705</a></li></ul></div>
  </div></div>
  <div class="item"><div class="clearfix">
    <div class="image-item"><a href="${B}/truyen-tranh/van-co-chi-ton/1714" title="Vạn Cổ Chí Tôn">
      <img src="https://s2.anhvip.xyz/comics/van-co-chi-ton.jpg" alt="Vạn Cổ Chí Tôn" class="image-item lazy"></a></div>
    <div class="caption"><h3><a href="${B}/truyen-tranh/van-co-chi-ton/1714" class="title-manga" data-id="1714">Vạn Cổ Chí Tôn</a></h3>
      <ul><li class="chapter-detail"><a href="${B}/truyen-tranh/van-co-chi-ton/chapter-566/3598179">Chapter 566</a></li></ul></div>
  </div></div>
</div></div></body></html>`;

const DETAIL = `<html><body>
  <div class="overview-comic"><div class="row"><div class="comic-right">
    <h1>Yêu Thần Ký</h1>
    <img src="https://i1.wp.com/s2.anhvip.xyz/comics/yeu-than-ky.jpg" alt="Yêu Thần Ký" class="image-comic">
    <ul>
      <li class="author row"><p class="info-name">Tác giả</p><p class="detail-info"> Đang cập nhật </p></li>
      <li class="status row"><p class="info-name">Tình trạng</p><p class="detail-info"><span class="label">Hoàn thành</span></p></li>
      <li class="category row"><p class="info-name">Thể loại</p><p class="detail-info">
        <span class="cat-detail"><a href="${B}/tim-truyen/action">Action</a></span>
        <span class="cat-detail"><a href="${B}/tim-truyen/phieu-luu">Adventure</a></span>
        <span class="cat-detail"><a href="${B}/tim-truyen/manhua">Manhua</a></span></p></li>
    </ul>
    <div class="detail-summary">Yêu Linh Sư mạnh nhất Thánh Linh Đại Lục Nhiếp Li, bởi vì một tai nạn mà xuyên không trở lại thời niên thiếu, quyết tâm bảo vệ những người thân yêu.</div>
  </div></div></div>
  <nav><ul>
    <li class="row" style="display:none"><div class="chapters"><a href="/truyen-tranh/vo-luyen-dinh-phong/chapter-2507/574633" class="chapter" data-chapter="699">Chapter 699:Truy cập toptruyen.net đọc chap mới nhất</a></div></li>
    <li class="row"><div class="chapters"><a href="/truyen-tranh/yeu-than-ky/chapter-705/3598612" class="chapter" data-chapter="705">Chapter 705</a></div></li>
    <li class="row"><div class="chapters"><a href="/truyen-tranh/yeu-than-ky/chapter-704/3598613" class="chapter" data-chapter="704">Chapter 704</a></div></li>
    <li class="row"><div class="chapters"><a href="/truyen-tranh/yeu-than-ky/chapter-1/3500000" class="chapter" data-chapter="1">Chapter 1</a></div></li>
  </ul></nav>
</body></html>`;

const CHAP = `<html><body><div class="list-image-detail">
  <div class="page-chapter"><img src="//s2.anhvip.xyz/comics/top/topzonee.jpg" alt="banner"></div>
  <div class="page-chapter"><img src="//s15.anhvip.xyz/image_comics/673/3598612/img_001.jpg?data=vipx"></div>
  <div class="page-chapter"><img src="//s15.anhvip.xyz/image_comics/673/3598612/img_002.jpg?data=vipx"></div>
</div><!-- dem cho du dai xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx --></body></html>`;

function fakeFetch(map) {
  return async (url) => {
    for (const [frag, html] of Object.entries(map)) {
      if (url.includes(frag)) return { ok: true, status: 200, async text() { return html; } };
    }
    return { ok: false, status: 404, async text() { return ''; } };
  };
}
const src = (map) => createTopTruyenSource({ fetchFn: fakeFetch(map), politeDelayMs: 0, retryDelayMs: 0 });

test('parseComicHref tách name + id, bỏ link chương', () => {
  assert.deepEqual(parseComicHref(`${B}/truyen-tranh/yeu-than-ky/673`), { name: 'yeu-than-ky', id: '673', slug: 'yeu-than-ky~673' });
  assert.equal(parseComicHref(`${B}/truyen-tranh/yeu-than-ky/chapter-705/3598612`), null);
  assert.equal(parseComicHref('#'), null);
});

test('splitSlug tách "<name>~<id>"', () => {
  assert.deepEqual(splitSlug('yeu-than-ky~673'), { name: 'yeu-than-ky', id: '673' });
  assert.deepEqual(splitSlug('khong-co-id'), { name: 'khong-co-id', id: '' });
});

test('chapterLabel lấy số chương', () => {
  assert.equal(chapterLabel('Chapter 705'), '705');
  assert.equal(chapterLabel('Chương 89.5'), '89.5');
});

test('home() đọc thẻ truyện, slug mang id', async () => {
  const { items } = await src({ '/tim-truyen': LIST }).home();
  assert.equal(items.length, 2);
  assert.equal(items[0].slug, 'yeu-than-ky~673');
  assert.equal(items[0].name, 'Yêu Thần Ký');
  assert.equal(items[0].latestChapter, '705');
  assert.ok(items[0].thumbUrl.includes('anhvip.xyz'));
});

test('list() phân trang bằng ?page=N', async () => {
  let asked = '';
  const s = createTopTruyenSource({
    politeDelayMs: 0, retryDelayMs: 0,
    fetchFn: async (url) => { asked = url; return { ok: true, status: 200, async text() { return LIST; } }; },
  });
  await s.list('truyen-moi', 3);
  assert.ok(asked.includes('/tim-truyen?page=3'), 'thấy: ' + asked);
});

test('search() dùng /tim-truyen?keyword=', async () => {
  let asked = '';
  const s = createTopTruyenSource({
    politeDelayMs: 0, retryDelayMs: 0,
    fetchFn: async (url) => { asked = url; return { ok: true, status: 200, async text() { return LIST; } }; },
  });
  const { items } = await s.search('yeu than ky');
  assert.ok(asked.includes('/tim-truyen?keyword=yeu%20than%20ky'), 'thấy: ' + asked);
  assert.deepEqual(items.map(i => i.slug), ['yeu-than-ky~673', 'van-co-chi-ton~1714']);
});

test('detail() đọc tên/trạng thái/thể loại/giới thiệu, dựng URL có id', async () => {
  let asked = '';
  const s = createTopTruyenSource({
    politeDelayMs: 0, retryDelayMs: 0,
    fetchFn: async (url) => { asked = url; return { ok: true, status: 200, async text() { return DETAIL; } }; },
  });
  const d = await s.detail('yeu-than-ky~673');
  assert.ok(asked.includes('/truyen-tranh/yeu-than-ky/673'), 'URL chi tiết phải có id, thấy: ' + asked);
  assert.equal(d.name, 'Yêu Thần Ký');
  assert.equal(d.status, 'completed');
  assert.deepEqual(d.categories, ['Action', 'Adventure', 'Manhua']);
  assert.ok(d.content.includes('Yêu Linh Sư'));
  assert.ok(d.thumbUrl.includes('anhvip.xyz'));
  assert.equal(d.slug, 'yeu-than-ky~673');   // giữ nguyên slug có id
});

test('detail() bỏ chương quảng cáo trỏ sang truyện khác, mục lục tăng dần', async () => {
  const d = await src({ '/truyen-tranh/yeu-than-ky/673': DETAIL }).detail('yeu-than-ky~673');
  assert.deepEqual(d.chapters.map(c => c.name), ['1', '704', '705']);   // đã bỏ 699 (vo-luyen-dinh-phong)
  assert.equal(d.chapters[0].order, 0);
  assert.ok(d.chapters[0].apiUrl.includes('/truyen-tranh/yeu-than-ky/chapter-1/'));
});

test('detail() vẫn ra mục lục khi slug/name lệch với URL chương (vd slug kèm tiền tố)', async () => {
  // Slug còn mang tiền tố kho bổ sung; site vẫn ra đúng truyện (định tuyến theo id)
  // nhưng name trên link chương là 'yeu-than-ky' -> lọc theo nhóm phổ biến, không so slug.
  const s = createTopTruyenSource({
    politeDelayMs: 0, retryDelayMs: 0,
    fetchFn: async () => ({ ok: true, status: 200, async text() { return DETAIL; } }),
  });
  const d = await s.detail('ttz~yeu-than-ky~673');
  assert.deepEqual(d.chapters.map(c => c.name), ['1', '704', '705']);   // vẫn bỏ chương quảng cáo
  assert.ok(d.chapters[0].apiUrl.includes('/truyen-tranh/yeu-than-ky/chapter-1/'));
});

test('chapter() trả ảnh theo thứ tự, bỏ banner, xử lý // và giữ query', async () => {
  const { images } = await src({ '/chapter-705/': CHAP })
    .chapter(`${B}/truyen-tranh/yeu-than-ky/chapter-705/3598612`);
  assert.equal(images.length, 2);                       // banner topzonee đã bị bỏ
  assert.equal(images[0].page, 0);
  assert.ok(images[0].url.startsWith('https://s15.anhvip.xyz/'), 'phải đổi // -> https, thấy: ' + images[0].url);
  assert.ok(images[0].url.includes('?data=vipx'), 'giữ query ?data=');
});
