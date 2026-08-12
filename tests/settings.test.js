import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createSettings } from '../src/services/settings.js';

function db() { const d = openDb(':memory:'); createSchema(d); return d; }

test('get trả fallback khi chưa có key', () => {
  const s = createSettings(db());
  assert.equal(s.get('source', 'truyenqq'), 'truyenqq');
});

test('set rồi get lại đúng giá trị', () => {
  const s = createSettings(db());
  s.set('source', 'otruyen');
  assert.equal(s.get('source'), 'otruyen');
});

test('all trả toàn bộ cặp key/value', () => {
  const s = createSettings(db());
  s.set('a', '1'); s.set('b', '2');
  assert.deepEqual(s.all(), { a: '1', b: '2' });
});

test('seedDefaults chỉ nạp key còn thiếu, không ghi đè', () => {
  const s = createSettings(db());
  s.set('source', 'otruyen');
  s.seedDefaults({ source: 'truyenqq', truyenqq_base: 'https://x.com' });
  assert.equal(s.get('source'), 'otruyen', 'key đã có thì giữ nguyên');
  assert.equal(s.get('truyenqq_base'), 'https://x.com', 'key thiếu thì nạp');
});

test('seedDefaults bỏ qua giá trị null/undefined', () => {
  const s = createSettings(db());
  s.seedDefaults({ x: null, y: undefined, z: '' });
  assert.equal(s.get('x'), null);
  assert.equal(s.get('z'), '', 'chuỗi rỗng vẫn là giá trị hợp lệ');
});
