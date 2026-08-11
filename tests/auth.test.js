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

function appWith() {
  const db = openDb(':memory:');
  createSchema(db);
  return buildApp({
    passwordHash: hash, sessionSecret: 'test-secret', db,
    cacheDir: mkdtempSync(join(tmpdir(), 'wt-')),
  });
}

test('protected page redirects to /login when unauthenticated', async () => {
  const res = await request(appWith()).get('/').redirects(0);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login');
});

test('api route returns 401 when unauthenticated', async () => {
  const res = await request(appWith()).get('/api/library');
  assert.equal(res.status, 401);
});

test('login with wrong password fails', async () => {
  const res = await request(appWith()).post('/login').type('form').send({ password: 'nope' }).redirects(0);
  assert.equal(res.status, 401);
});

test('login with correct password sets session and allows access', async () => {
  const agent = request.agent(appWith());
  const login = await agent.post('/login').type('form').send({ password: 'secret123' }).redirects(0);
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, '/');
  const home = await agent.get('/healthz');
  assert.equal(home.status, 200);
});
