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
import { isAllowedHost, packImg, unpackImg } from '../src/routes/image.js';
import { IMAGE_HOSTS, refererFor } from '../src/config.js';

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

test('refererFor gửi Referer của TruyenQQ cho CDN của họ', () => {
  // CDN TruyenQQ chống hotlink theo trang chủ; dùng host ảnh sẽ bị 403
  assert.match(refererFor('https://s135.hinhhinh.com/3755/951/0.jpg'), /truyenqq/);
  assert.match(refererFor('https://i178.truyenvua.com/1/2/0.jpg'), /truyenqq/);
  assert.match(refererFor('https://111.tintruyen.net/1/2/0.jpg'), /truyenqq/);
  // Nguồn khác thì dùng chính origin của ảnh
  assert.equal(refererFor('https://img.otruyenapi.com/a.jpg'), 'https://img.otruyenapi.com/');
});

test('proxy chấp nhận host ảnh của TruyenQQ', () => {
  assert.ok(isAllowedHost('https://s135.hinhhinh.com/a.jpg', IMAGE_HOSTS));
  assert.ok(isAllowedHost('https://i178.truyenvua.com/a.jpg', IMAGE_HOSTS));
  assert.ok(!isAllowedHost('https://evil.com/a.jpg', IMAGE_HOSTS));
});

test('packImg / unpackImg khớp nhau', () => {
  const url = 'https://s135.hinhhinh.com/3755/951/0.jpg?gt=hdfgdfg';
  const packed = packImg(url);
  assert.doesNotMatch(packed, /hinhhinh|https/, 'URL gói lại không được lộ host');
  assert.equal(unpackImg(packed), url);
});

test('/img nhận URL đã gói (?i=) và vẫn chặn host lạ', async () => {
  const agent = request.agent(agentApp());
  await agent.post('/login').type('form').send({ password: 'secret123' });
  const ok = await agent.get('/img?i=' + packImg('https://i178.truyenvua.com/1/2/0.jpg'));
  assert.equal(ok.status, 200);
  const bad = await agent.get('/img?i=' + packImg('https://evil.com/a.jpg'));
  assert.equal(bad.status, 403);
});

test('trang không còn lộ host CDN trong mã nguồn', async () => {
  const agent = request.agent(agentApp());
  await agent.post('/login').type('form').send({ password: 'secret123' });
  const res = await agent.get('/');
  assert.doesNotMatch(res.text, /img\?u=/, 'không được dùng dạng URL thô nữa');
});

test('ảnh đã lưu Drive vẫn đọc được kể cả khi NGUỒN GỐC chết', async () => {
  const db = openDb(':memory:');
  createSchema(db);
  const srcUrl = 'https://i178.truyenvua.com/1/2/0.jpg';
  // giả lập: ảnh này đã được lưu lên Drive trước đó
  db.prepare(`INSERT INTO archive (src_url, comic_slug, chapter_name, image_page, drive_id, bytes, created_at)
              VALUES (?,?,?,?,?,?,?)`).run(srcUrl, 's', '1', 0, 'drive-file-1', 3, Date.now());

  const app = buildApp({
    passwordHash: hash, sessionSecret: 't', db,
    cacheDir: mkdtempSync(join(tmpdir(), 'imgc-')),
    // nguồn gốc coi như đã chết
    imageFetchFn: async () => { throw new Error('nguồn chết'); },
    // Drive giả: trả nội dung đã lưu
    drive: { configured: true, async download() { return { buf: Buffer.from('anh-tu-drive'), contentType: 'image/jpeg' }; } },
  });

  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ password: 'secret123' });
  const res = await agent.get('/img?i=' + packImg(srcUrl)).buffer(true);
  assert.equal(res.status, 200, 'phải phục vụ được từ Drive dù nguồn chết');
  assert.equal(res.body.toString(), 'anh-tu-drive');
});

test('/img đổi sang host dự phòng khi host chính lỗi (ảnh chương kho bổ sung)', async () => {
  const db = openDb(':memory:');
  createSchema(db);
  const app = buildApp({
    passwordHash: hash, sessionSecret: 't', db,
    cacheDir: mkdtempSync(join(tmpdir(), 'imgc-')),
    // host chính truyenonline.cc lỗi; host dự phòng otruyencdn.com trả ảnh
    imageFetchFn: async (u) => {
      if (u.includes('images.truyenonline.cc')) throw new Error('CDN chính chết');
      if (u.includes('otruyencdn.com')) return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([9]).buffer };
      return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    },
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ password: 'secret123' });
  const url = 'https://images.truyenonline.cc/uploads/x/chapter_1/page_1.jpg';
  const res = await agent.get('/img?i=' + packImg(url));
  assert.equal(res.status, 200);                 // lấy được nhờ đổi sang otruyencdn.com
  assert.equal(res.headers['content-type'], 'image/jpeg');
});
