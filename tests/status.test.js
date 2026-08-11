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
  const source = { async detail(){return {slug:'s',name:'S',thumbUrl:'',origin:'',content:'',status:'ongoing',categories:[],chapters:[]};} };
  return buildApp({
    passwordHash: hash, sessionSecret: 't', db, source,
    cacheDir: mkdtempSync(join(tmpdir(), 'wt-')),
  });
}
async function authed() { const a = request.agent(makeApp()); await a.post('/login').type('form').send({ password: 'secret123' }); return a; }

test('GET /api/status returns counts', async () => {
  const agent = await authed();
  const res = await agent.get('/api/status');
  assert.equal(res.status, 200);
  assert.ok('followedCount' in res.body);
  assert.ok('cacheBytes' in res.body);
});

test('change password returns a new hash to paste', async () => {
  const agent = await authed();
  const res = await agent.post('/settings/password').send({ current: 'secret123', next: 'newpass123' });
  assert.equal(res.status, 200);
  assert.ok(res.body.hash.startsWith('$2'));
});
