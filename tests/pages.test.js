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
  const detail = {
    slug: 'tien-nghich', name: 'Tiên Nghịch', thumbUrl: 'https://img.otruyenapi.com/uploads/comics/t.jpg',
    origin: '', content: '<p>abc</p>', status: 'ongoing', categories: ['Action'],
    chapters: [{ name: '1', title: '', apiUrl: 'u1', order: 0 }],
  };
  const source = {
    async detail() { return detail; },
    async home() { return { items: [{ slug: 'x', name: 'Truyện Mới X', thumbUrl: '', updatedAt: null, latestChapter: '10' }], pagination: null }; },
    async categories() { return [{ name: 'Ngôn Tình', slug: 'ngon-tinh' }, { name: 'Action', slug: 'action' }]; },
  };
  return buildApp({
    passwordHash: hash, sessionSecret: 't', db, source,
    cacheDir: mkdtempSync(join(tmpdir(), 'wt-')),
  });
}
async function authed() { const a = request.agent(makeApp()); await a.post('/login').type('form').send({ password: 'secret123' }); return a; }

test('home renders followed + recent-from-API section', async () => {
  const agent = await authed();
  const res = await agent.get('/');
  assert.equal(res.status, 200);
  assert.match(res.text, /Kệ Truyện/);
  assert.match(res.text, /Truyện mới cập nhật/);
  assert.match(res.text, /Truyện Mới X/); // came from source.home()
});

test('browse page renders genre chips from categories', async () => {
  const agent = await authed();
  const res = await agent.get('/browse');
  assert.equal(res.status, 200);
  assert.match(res.text, /Ngôn Tình/);
  assert.match(res.text, /data-cat="action"/);
});

test('search page prefills q from query string', async () => {
  const agent = await authed();
  const res = await agent.get('/search?q=abc');
  assert.equal(res.status, 200);
  assert.match(res.text, /value="abc"/);
});

test('detail page renders comic name and chapters', async () => {
  const agent = await authed();
  const res = await agent.get('/truyen/tien-nghich');
  assert.equal(res.status, 200);
  assert.match(res.text, /Tiên Nghịch/);
  assert.match(res.text, /Chương 1/);
});
