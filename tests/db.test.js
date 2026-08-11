import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';

test('createSchema creates all tables', () => {
  const db = openDb(':memory:');
  createSchema(db);
  const names = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all().map(r => r.name);
  for (const t of ['comics', 'chapters', 'reading_progress', 'settings', 'api_cache']) {
    assert.ok(names.includes(t), `missing table ${t}`);
  }
});

test('comics table round-trips a row', () => {
  const db = openDb(':memory:');
  createSchema(db);
  db.prepare(`INSERT INTO comics (slug, name, thumb_url, status, categories, updated_at_source, followed_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run('abc', 'Test', 'abc-thumb.jpg', 'ongoing', 'Action', '2026-01-01T00:00:00Z', Date.now());
  const row = db.prepare('SELECT * FROM comics WHERE slug=?').get('abc');
  assert.equal(row.name, 'Test');
});
