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

const hash = bcrypt.hashSync('secret123', 10);
function makeApp() {
  const db = openDb(':memory:'); createSchema(db);
  const detail = { slug: 's', name: 'S', thumbUrl: '', origin: '', content: '', status: 'ongoing', categories: [],
    chapters: [
      { name: '1', title: '', apiUrl: 'https://sv1.otruyencdn.com/v1/api/chapter/a', order: 0 },
      { name: '2', title: '', apiUrl: 'https://sv1.otruyencdn.com/v1/api/chapter/b', order: 1 },
    ] };
  const source = {
    async detail() { return detail; },
    async chapter() {
      return { images: [
        { page: 0, url: 'https://sv1.otruyencdn.com/uploads/x/chapter_1/page_0.jpg' },
        { page: 1, url: 'https://sv1.otruyencdn.com/uploads/x/chapter_1/page_1.jpg' },
      ] };
    },
  };
  return buildApp({
    passwordHash: hash, sessionSecret: 't', db, source,
    cacheDir: mkdtempSync(join(tmpdir(), 'wt-')),
  });
}
async function authed() { const a = request.agent(makeApp()); await a.post('/login').type('form').send({ password: 'secret123' }); return a; }

test('reader renders images through /img and shows next chapter', async () => {
  const agent = await authed();
  await agent.post('/api/follow').send({ slug: 's' });
  const res = await agent.get('/doc/s/1');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/img\?i=/); // URL ảnh đã gói, không lộ host CDN
  assert.match(res.text, /Chương 2/); // next-chapter control
});
