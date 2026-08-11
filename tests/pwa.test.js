import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { buildApp } from '../src/app.js';

function makeApp() {
  const db = openDb(':memory:'); createSchema(db);
  return buildApp({
    passwordHash: '', sessionSecret: 't', db,
    cacheDir: mkdtempSync(join(tmpdir(), 'wt-')),
  });
}

test('manifest is served with correct name', async () => {
  const res = await request(makeApp()).get('/public/manifest.webmanifest');
  assert.equal(res.status, 200);
  const m = JSON.parse(res.text);
  assert.equal(m.name, 'Kệ Truyện');
  assert.equal(m.display, 'standalone');
});
