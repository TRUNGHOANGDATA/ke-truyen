import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSupplement } from '../src/source/merged.js';

// Nguồn chính giả: viết setBase theo kiểu `this` để bắt lỗi mất ngữ cảnh khi
// lớp gộp cho các hàm phụ đi xuyên qua.
function fakeQQ(items = [], over = {}) {
  return {
    base: 'https://qq',
    setBase(b) { this.base = b; },
    getBase() { return this.base; },
    async home() { return { items: [{ name: 'Hot QQ', slug: 'hot-qq' }] }; },
    async list() { return { items }; },
    async search() { return { items }; },
    async categories() { return [{ name: 'Hành Động', slug: 'hanh-dong-99' }]; },
    async byCategory() { return { items }; },
    async detail(slug) { return { slug, name: 'QQ ' + slug, chapters: [] }; },
    async chapter(url) { return { via: 'qq', url }; },
    ...over,
  };
}

function fakeOT(items = [], over = {}) {
  return {
    async home() { return { items: [{ name: 'Hot OT', slug: 'hot-ot' }] }; },
    async list() { return { items }; },
    async search() { return { items }; },
    async categories() { return [{ name: 'Hành động', slug: 'action' }]; },
    async byCategory() { return { items }; },
    async detail(slug) { return { slug, name: 'OT ' + slug, chapters: [] }; },
    async chapter(url) { return { via: 'ot', url }; },
    ...over,
  };
}

test('bộ nào nguồn chính đã có thì bỏ, chỉ chèn bộ còn thiếu', async () => {
  const s = withSupplement(
    fakeQQ([{ name: 'Đại Đường Vô Song', slug: 'dai-duong-vo-song-3512' }]),
    fakeOT([
      { name: 'ĐẠI ĐƯỜNG VÔ SONG', slug: 'dai-duong-vo-song' },       // trùng -> bỏ
      { name: 'Đại Đường Song Long Truyện', slug: 'dai-duong-song-long-truyen' },
    ]),
  );
  const { items } = await s.search('đại đường');
  assert.equal(items.length, 2);
  assert.equal(items[0].slug, 'dai-duong-vo-song-3512');            // nguồn chính đứng trước
  assert.equal(items[1].slug, 'ot~dai-duong-song-long-truyen');     // bổ sung có tiền tố
  assert.equal(items[1].fromSupplement, true);
});

test('trùng nhau trong chính nguồn bổ sung cũng bị loại', async () => {
  const s = withSupplement(fakeQQ([]), fakeOT([
    { name: 'Một Bộ', slug: 'mot-bo-a' },
    { name: 'một bộ', slug: 'mot-bo-b' },
  ]));
  const { items } = await s.search('x');
  assert.deepEqual(items.map(i => i.slug), ['ot~mot-bo-a']);
});

test('nguồn bổ sung lỗi thì vẫn trả nguyên kết quả nguồn chính', async () => {
  const s = withSupplement(
    fakeQQ([{ name: 'A', slug: 'a' }]),
    fakeOT([], { async search() { throw new Error('nguồn bổ sung chết'); } }),
  );
  const { items } = await s.search('a');
  assert.deepEqual(items.map(i => i.slug), ['a']);
});

test('detail định tuyến theo tiền tố và gắn lại tiền tố vào slug trả về', async () => {
  const s = withSupplement(fakeQQ(), fakeOT());
  const own = await s.detail('abc-123');
  assert.equal(own.name, 'QQ abc-123');

  const sup = await s.detail('ot~xyz');
  assert.equal(sup.name, 'OT xyz');          // gọi nguồn bổ sung với slug đã bỏ tiền tố
  assert.equal(sup.slug, 'ot~xyz');          // trả về vẫn có tiền tố -> thư viện lưu đúng
  assert.equal(sup.fromSupplement, true);
});

test('chapter định tuyến theo host của URL', async () => {
  const s = withSupplement(fakeQQ(), fakeOT());
  assert.equal((await s.chapter('https://truyenqqko.com/truyen/x/chuong-1')).via, 'qq');
  assert.equal((await s.chapter('https://sv1.otruyencdn.com/v1/api/chapter/a')).via, 'ot');
  assert.equal((await s.chapter('https://otruyenapi.com/v1/api/chapter/b')).via, 'ot');
  assert.equal((await s.chapter('khong-phai-url')).via, 'qq');   // không parse được -> nguồn chính
});

test('byCategory dịch slug thể loại giữa hai nguồn theo tên', async () => {
  let asked = null;
  const s = withSupplement(
    fakeQQ([{ name: 'A', slug: 'a' }]),
    fakeOT([{ name: 'B', slug: 'b' }], {
      async byCategory(slug) { asked = slug; return { items: [{ name: 'B', slug: 'b' }] }; },
    }),
  );
  const { items } = await s.byCategory('hanh-dong-99');
  assert.equal(asked, 'action');                       // 'Hành Động' -> 'Hành động'
  assert.deepEqual(items.map(i => i.slug), ['a', 'ot~b']);
});

test('thể loại không dịch được thì chỉ dùng nguồn chính', async () => {
  const s = withSupplement(
    fakeQQ([{ name: 'A', slug: 'a' }]),
    fakeOT([{ name: 'B', slug: 'b' }], { async categories() { return [{ name: 'Manga', slug: 'manga' }]; } }),
  );
  const { items } = await s.byCategory('hanh-dong-99');
  assert.deepEqual(items.map(i => i.slug), ['a']);
});

test('trang chủ và danh sách thể loại chỉ lấy từ nguồn chính', async () => {
  const s = withSupplement(fakeQQ(), fakeOT());
  assert.deepEqual((await s.home()).items.map(i => i.slug), ['hot-qq']);
  assert.deepEqual((await s.categories()).map(c => c.slug), ['hanh-dong-99']);
});

/* ---------- Nhiều kho bổ sung: tự chuyển dự phòng + định tuyến theo tiền tố ---------- */

// Mỗi kho là một site riêng (slug khác nhau) nên phải có tiền tố + host riêng.
const supEntry = (id, prefix, host, over = {}) => ({
  prefix,
  src: {
    getBase: () => 'https://' + host,
    async home() { return { items: [] }; },
    async list() { return { items: [{ name: 'Bộ ' + id, slug: 'bo-' + id }] }; },
    async search() { return { items: [{ name: 'Bộ ' + id, slug: 'bo-' + id }] }; },
    async categories() { return [{ name: 'Hành động', slug: 'act-' + id }]; },
    async byCategory() { return { items: [{ name: 'Bộ ' + id, slug: 'bo-' + id }] }; },
    async detail(slug) { return { slug, name: id + ' ' + slug, chapters: [] }; },
    async chapter(url) { return { via: id, url }; },
    ...over,
  },
});

test('kho ưu tiên chết thì tự dùng kho dự phòng, kèm ĐÚNG tiền tố của kho đó', async () => {
  const s = withSupplement(fakeQQ([{ name: 'A', slug: 'a' }]), [
    supEntry('mot', 'ot~', 'mot.com', { async search() { throw new Error('kho 1 chết'); } }),
    supEntry('hai', 'nar~', 'hai.com'),
  ]);
  const { items } = await s.search('x');
  assert.deepEqual(items.map(i => i.slug), ['a', 'nar~bo-hai']);
});

test('kho ưu tiên còn sống thì không đụng tới kho dự phòng', async () => {
  let chamKhoHai = false;
  const s = withSupplement(fakeQQ([]), [
    supEntry('mot', 'ot~', 'mot.com'),
    supEntry('hai', 'nar~', 'hai.com', { async search() { chamKhoHai = true; return { items: [] }; } }),
  ]);
  const { items } = await s.search('x');
  assert.deepEqual(items.map(i => i.slug), ['ot~bo-mot']);
  assert.equal(chamKhoHai, false);
});

test('detail về đúng kho theo tiền tố slug', async () => {
  const s = withSupplement(fakeQQ(), [
    supEntry('mot', 'ot~', 'mot.com'),
    supEntry('hai', 'nar~', 'hai.com'),
  ]);
  assert.equal((await s.detail('abc')).name, 'QQ abc');
  assert.equal((await s.detail('ot~abc')).name, 'mot abc');
  const hai = await s.detail('nar~abc');
  assert.equal(hai.name, 'hai abc');
  assert.equal(hai.slug, 'nar~abc');           // giữ tiền tố -> thư viện lưu đúng kho
});

test('chapter về đúng kho theo host, kho cũ vẫn nhận host đời trước', async () => {
  const s = withSupplement(fakeQQ(), [
    supEntry('mot', 'ot~', 'nettruyen.id'),
    supEntry('hai', 'nar~', 'nettruyenar.com'),
  ]);
  assert.equal((await s.chapter('https://nettruyen.id/truyen-tranh/x/chuong-1')).via, 'mot');
  assert.equal((await s.chapter('https://nettruyenar.com/truyen-tranh/x/chuong-1')).via, 'hai');
  // dữ liệu cũ còn trỏ tới CDN OTruyen -> vẫn phải về kho mang tiền tố 'ot~'
  assert.equal((await s.chapter('https://sv1.otruyencdn.com/v1/api/chapter/a')).via, 'mot');
  assert.equal((await s.chapter('https://truyenqqko.com/truyen/x/chuong-1')).via, 'qq');
});

test('supplementPrefixes liệt kê tiền tố của mọi kho', async () => {
  const s = withSupplement(fakeQQ(), [
    supEntry('mot', 'ot~', 'mot.com'),
    supEntry('hai', 'nar~', 'hai.com'),
  ]);
  assert.deepEqual(s.supplementPrefixes(), ['ot~', 'nar~']);
});

test('mọi kho đều chết thì trả nguyên kết quả nguồn chính', async () => {
  const boom = { async search() { throw new Error('chết'); } };
  const s = withSupplement(fakeQQ([{ name: 'A', slug: 'a' }]), [
    supEntry('mot', 'ot~', 'mot.com', boom),
    supEntry('hai', 'nar~', 'hai.com', boom),
  ]);
  assert.deepEqual((await s.search('a')).items.map(i => i.slug), ['a']);
});

test('đổi domain vẫn xuyên qua lớp gộp tới nguồn chính', async () => {
  const qq = fakeQQ();
  const s = withSupplement(qq, fakeOT());
  s.setBase('https://qq-moi.com');
  assert.equal(qq.base, 'https://qq-moi.com');   // đúng đối tượng, không phải bản copy
  assert.equal(s.getBase(), 'https://qq-moi.com');
});
