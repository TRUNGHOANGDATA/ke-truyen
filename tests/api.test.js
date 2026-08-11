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
  const db = openDb(':memory:');
  createSchema(db);
  const detail = {
    slug: 'tien-nghich', name: 'Tiên Nghịch', thumbUrl: 't.jpg', status: 'ongoing',
    categories: ['Action'], chapters: [{ name: '1', title: '', apiUrl: 'u1', order: 0 }],
  };
  const source = {
    async detail() { return detail; },
    async search() { return { items: [{ slug: 'tien-nghich', name: 'Tiên Nghịch' }] }; },
    async home() { return { items: [], pagination: null }; },
    async list() { return { items: [], pagination: null }; },
    async byCategory() { return { items: [], pagination: null }; },
    async categories() { return [{ name: 'Action', slug: 'action' }]; },
  };
  return buildApp({
    passwordHash: hash, sessionSecret: 't', db, source,
    cacheDir: mkdtempSync(join(tmpdir(), 'wt-')),
  });
}

async function authed() {
  const agent = request.agent(makeApp());
  await agent.post('/login').type('form').send({ password: 'secret123' });
  return agent;
}

test('follow then library lists it', async () => {
  const agent = await authed();
  const f = await agent.post('/api/follow').send({ slug: 'tien-nghich' });
  assert.equal(f.status, 200);
  const lib = await agent.get('/api/library');
  assert.equal(lib.body.items.length, 1);
  assert.equal(lib.body.items[0].slug, 'tien-nghich');
});

test('search proxies to source', async () => {
  const agent = await authed();
  const res = await agent.get('/api/search?q=tien');
  assert.equal(res.body.items[0].slug, 'tien-nghich');
});

test('progress saves and library reflects it', async () => {
  const agent = await authed();
  await agent.post('/api/follow').send({ slug: 'tien-nghich' });
  const p = await agent.post('/api/progress').send({ slug: 'tien-nghich', chapter: '1', page: 5 });
  assert.equal(p.status, 200);
  const lib = await agent.get('/api/library');
  assert.equal(lib.body.items[0].progress.imagePage, 5);
});
