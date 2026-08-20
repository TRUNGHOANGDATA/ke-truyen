import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titleKey } from '../src/source/title-key.js';

test('cùng một bộ viết khác dấu / khác hoa thường ra cùng khoá', () => {
  const k = titleKey('Đại Đường: Vô Song');
  assert.equal(titleKey('dai duong vo song'), k);
  assert.equal(titleKey('ĐẠI ĐƯỜNG VÔ SONG!!!'), k);
  assert.equal(titleKey('  Đại   Đường - Vô Song  '), k);
});

test('bỏ được chữ đ (NFD không tách chữ này)', () => {
  assert.equal(titleKey('Đông Đô'), 'dong do');
  assert.ok(!titleKey('Đại').includes('đ'));
});

test('hai bộ khác tên thì khác khoá', () => {
  assert.notEqual(titleKey('Đại Đường Vô Song'), titleKey('Đại Đường Song Long Truyện'));
});

test('tên rỗng / thiếu trả về chuỗi rỗng', () => {
  assert.equal(titleKey(''), '');
  assert.equal(titleKey(null), '');
  assert.equal(titleKey(undefined), '');
});
