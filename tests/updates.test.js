import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createLibrary } from '../src/services/library.js';
import { createUpdates } from '../src/services/updates.js';

function make(chaptersAfter) {
  const db = openDb(':memory:');
  createSchema(db);
  const lib = createLibrary(db);
  lib.follow({ slug: 's', name: 'S', thumbUrl: '', status: 'ongoing', categories: [],
    chapters: [{ name: '1', title: '', apiUrl: 'u1', order: 0 }] });
  const source = {
    async detail() {
      return { slug: 's', name: 'S', thumbUrl: '', status: 'ongoing', categories: [], chapters: chaptersAfter };
    },
  };
  return createUpdates({ library: lib, source });
}

test('checkOne reports new chapters and stores them', async () => {
  const upd = make([
    { name: '1', title: '', apiUrl: 'u1', order: 0 },
    { name: '2', title: '', apiUrl: 'u2', order: 1 },
    { name: '3', title: '', apiUrl: 'u3', order: 2 },
  ]);
  const r = await upd.checkOne('s');
  assert.equal(r.newCount, 2);
  assert.equal(r.latest, '3');
});

test('checkOne reports zero when nothing new', async () => {
  const upd = make([{ name: '1', title: '', apiUrl: 'u1', order: 0 }]);
  const r = await upd.checkOne('s');
  assert.equal(r.newCount, 0);
});
