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
  const db = openDb(':memory:');
  createSchema(db);
  return buildApp({
    passwordHash: '', sessionSecret: 't', db,
    cacheDir: mkdtempSync(join(tmpdir(), 'wt-')),
  });
}

test('GET /healthz returns ok', async () => {
  const res = await request(makeApp()).get('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
