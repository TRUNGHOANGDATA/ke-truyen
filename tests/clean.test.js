import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSynopsis, scrubBrands } from '../src/source/clean.js';

test('drops a synopsis that is only source-site promo', () => {
  const html = '<p>Truyện tranh Witchriv được cập nhật nhanh và đầy đủ nhất tại TruyenQQ. ' +
    'Bạn đọc đừng quên để lại bình luận và chia sẻ, ủng hộ TruyenQQ ra các chương mới nhất của truyện Witchriv.</p>';
  assert.equal(cleanSynopsis(html), '');
});

test('keeps the real story text and strips the promo sentence', () => {
  const html = '<p>Nhiếp Ly trở về năm 13 tuổi, tu luyện công pháp mạnh nhất để báo thù kẻ địch kiếp trước. ' +
    'Truyện được cập nhật nhanh nhất tại TruyenQQ.</p>';
  const out = cleanSynopsis(html);
  assert.match(out, /Nhiếp Ly trở về năm 13 tuổi/);
  assert.doesNotMatch(out, /TruyenQQ/);
  assert.doesNotMatch(out, /cập nhật nhanh nhất/);
});

test('strips tags and decodes entities', () => {
  const html = '<p>Anh &amp; em cùng nhau bảo vệ khu phố bằng nắm đấm.<br>Trận chiến bắt đầu từ đây.</p>';
  const out = cleanSynopsis(html);
  assert.doesNotMatch(out, /<[^>]+>/);
  assert.match(out, /Anh & em/);
});

test('returns empty string for empty or missing input', () => {
  assert.equal(cleanSynopsis(''), '');
  assert.equal(cleanSynopsis(undefined), '');
  assert.equal(cleanSynopsis('<p>Ngắn quá.</p>'), '');
});

test('scrubBrands bỏ tên trang nguồn khỏi chữ hiển thị', () => {
  assert.equal(scrubBrands('Đọc tại TruyenQQ ngay'), 'Đọc tại ngay');
  assert.equal(scrubBrands('truyenqqko.com'), '.com');
  assert.equal(scrubBrands('Nguyên Tôn'), 'Nguyên Tôn');
});

test('bỏ đoạn SEO tự sinh, giữ lại phần cốt truyện', () => {
  const html = '<p>Thalia là nàng công chúa bất hạnh, lớn lên giữa những người thờ ơ và ' +
    'tự bảo vệ mình bằng những chiếc gai nhọn với bất cứ ai đến gần.</p>' +
    '<p><strong>Cánh Đồng Bị Quên Lãng</strong> là một trong những tác phẩm nổi bật thuộc ' +
    'nhóm thể loại <strong>Manhwa</strong>, được chấp bút bởi <a href="/tac-gia/x">Mộng Tiên Giới</a>.</p>' +
    '<p>Kể từ khi ra mắt, truyện đã ghi nhận hơn 89,516 lượt xem.</p>' +
    '<p>Theo dõi truyện trên <a href="https://truyenqqko.com/">TruyenQQ</a> để cập nhật chương mới.</p>';
  const out = cleanSynopsis(html);
  assert.match(out, /Thalia là nàng công chúa bất hạnh/);
  assert.doesNotMatch(out, /<[^>]+>/, 'không được còn thẻ HTML');
  assert.doesNotMatch(out, /truyenqq/i, 'không được còn tên nguồn');
  assert.doesNotMatch(out, /tác phẩm nổi bật|chấp bút|lượt xem|cập nhật chương mới/i, 'phải bỏ hết đoạn SEO');
});
