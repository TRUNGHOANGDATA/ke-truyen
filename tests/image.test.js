import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { buildApp } from '../src/app.js';
import { isAllowedHost } from '../src/routes/image.js';

const hash = bcrypt.hashSync('secret123', 10);
function agentApp() {
  const db = openDb(':memory:');
  createSchema(db);
  return buildApp({
    passwordHash: hash, sessionSecret: 't', db,
    cacheDir: mkdtempSync(join(tmpdir(), 'imgc-')),
    imageFetchFn: async () => ({
      ok: true, status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }),
  });
}

test('isAllowedHost enforces whitelist', () => {
  const allow = ['img.otruyenapi.com', 'otruyencdn.com'];
  assert.ok(isAllowedHost('https://sv1.otruyencdn.com/x.jpg', allow));
  assert.ok(isAllowedHost('https://img.otruyenapi.com/x.jpg', allow));
  assert.ok(!isAllowedHost('https://evil.com/x.jpg', allow));
});

test('/img rejects non-whitelisted host with 403', async () => {
  const agent = request.agent(agentApp());
  await agent.post('/login').type('form').send({ password: 'secret123' });
  const res = await agent.get('/img?u=' + encodeURIComponent('https://evil.com/a.jpg'));
  assert.equal(res.status, 403);
});

test('/img serves whitelisted image', async () => {
  const agent = request.agent(agentApp());
  await agent.post('/login').type('form').send({ password: 'secret123' });
  const url = 'https://sv1.otruyencdn.com/uploads/x/chapter_1/page_0.jpg';
  const res = await agent.get('/img?u=' + encodeURIComponent(url));
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], 'image/jpeg');
});

test('/img requires auth', async () => {
  const res = await request(agentApp()).get('/img?u=' + encodeURIComponent('https://img.otruyenapi.com/a.jpg'));
  assert.equal(res.status, 401);
});
