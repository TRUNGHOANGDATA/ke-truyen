import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSynopsis } from '../src/source/clean.js';

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
