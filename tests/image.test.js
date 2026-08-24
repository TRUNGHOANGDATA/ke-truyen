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

test('CDN chống hotlink: proxy thử base của nguồn rồi NHỚ referer đó cho ảnh sau', async () => {
  const OK_REF = 'https://nettruyenar.com/';
  const tried = [];
  const db = openDb(':memory:'); createSchema(db);
  const app = buildApp({
    passwordHash: hash, sessionSecret: 't', db,
    cacheDir: mkdtempSync(join(tmpdir(), 'imgref-')),
    // nguồn giả: base của nó chính là referer duy nhất CDN chấp nhận
    manager: { comicSources: () => [{ id: 'x', label: 'X', prefix: '', src: { getBase: () => 'https://nettruyenar.com' } }] },
    imageFetchFn: async (_u, opts) => {
      tried.push(opts.headers.Referer);
      if (opts.headers.Referer !== OK_REF) return { ok: false, status: 403, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([9]).buffer };
    },
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ password: 'secret123' });

  // hinhtruyen.com nằm trong whitelist tĩnh; refererFor trả referer TruyenQQ -> bị 403,
  // phải rơi xuống base của nguồn mới lấy được ảnh.
  const first = await agent.get('/img?i=' + packImg('https://hinhtruyen.com/a/0.jpg'));
  assert.equal(first.status, 200);
  assert.ok(tried.includes(OK_REF), 'phải thử tới base của nguồn, đã thử: ' + tried.join(', '));
  assert.ok(tried.length > 1, 'ảnh đầu phải dò qua vài referer');

  // ảnh khác CÙNG host: đi thẳng bằng referer đã nhớ, không dò lại
  tried.length = 0;
  const second = await agent.get('/img?i=' + packImg('https://hinhtruyen.com/a/1.jpg'));
  assert.equal(second.status, 200);
  assert.deepEqual(tried, [OK_REF], 'phải trúng ngay lần đầu nhờ referer đã học');
});

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

/* ---------- Ảnh hỏng phải BỎ SỚM, không quét hết ma trận host × referer ----------
   Từng có lỗi: một ảnh chết ngốn 80 giây rồi mới 502, kéo sập tốc độ đọc cả chương. */

function proxyApp(imageFetchFn) {
  const db = openDb(':memory:'); createSchema(db);
  return buildApp({
    passwordHash: hash, sessionSecret: 't', db, imageFetchFn,
    cacheDir: mkdtempSync(join(tmpdir(), 'imgb-')),
    // 4 nguồn -> referersFor() dài, đúng tình huống đã gây chậm
    manager: { comicSources: () => ['a', 'b', 'c', 'd'].map((x, i) => ({
      id: x, label: x, prefix: i ? x + '~' : '', src: { getBase: () => `https://nguon${i}.com` } })) },
  });
}
async function authedProxy(fetchFn) {
  const a = request.agent(proxyApp(fetchFn));
  await a.post('/login').type('form').send({ password: 'secret123' });
  return a;
}
// host có bản sao: images.truyenonline.cc <-> sv1.otruyencdn.com <-> otruyencdn.com
const MIRRORED = 'https://images.truyenonline.cc/u/chapter_1/page_1.jpg';

test('host không phản hồi: mỗi host thử ĐÚNG 1 lần, không lặp qua từng referer', async () => {
  const tried = [];
  const a = await authedProxy(async (u) => {
    tried.push(new URL(u).hostname);
    throw Object.assign(new Error('timeout'), { name: 'AbortError' });
  });
  const res = await a.get('/img?i=' + packImg(MIRRORED));
  assert.equal(res.status, 502);
  assert.deepEqual(tried, ['images.truyenonline.cc', 'sv1.otruyencdn.com', 'otruyencdn.com'],
    'phải sang host khác ngay, không thử lại referer trên host đã chết');
});

// Mỗi CDN từ chối hotlink một kiểu (403, 404, 429, trang lỗi...). Từng có lỗi:
// chỉ coi 401/403 là "đáng thử referer khác" -> CDN từ chối bằng 404 thì không
// bao giờ tới được referer đúng, ảnh vỡ sạch.
for (const status of [403, 404, 429, 500]) {
  test(`host trả lời ${status}: van thử referer khác trên chính host đó`, async () => {
    const perHost = new Map();
    const a = await authedProxy(async (u) => {
      const h = new URL(u).hostname;
      perHost.set(h, (perHost.get(h) || 0) + 1);
      return { ok: false, status, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) };
    });
    await a.get('/img?i=' + packImg(MIRRORED));
    assert.ok(perHost.get('images.truyenonline.cc') > 1,
      `host con song thi phai quet them referer, thay: ${perHost.get('images.truyenonline.cc')}`);
  });
}

test('CDN từ chối bằng 404 nhưng đúng referer thì cho ảnh -> vẫn phải lấy được', async () => {
  const OK_REF = 'https://nguon2.com/';
  const a = await authedProxy(async (_u, opts) => (opts.headers.Referer === OK_REF
    ? { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([5]).buffer }
    : { ok: false, status: 404, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) }));
  const res = await a.get('/img?i=' + packImg(MIRRORED));
  assert.equal(res.status, 200, 'phải quét tới referer đúng chứ không bỏ host sớm');
});

test('403 thì thử referer khác trên cùng host', async () => {
  const perHost = new Map();
  const a = await authedProxy(async (u) => {
    const h = new URL(u).hostname;
    perHost.set(h, (perHost.get(h) || 0) + 1);
    return { ok: false, status: 403, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) };
  });
  await a.get('/img?i=' + packImg(MIRRORED));
  assert.ok(perHost.get('images.truyenonline.cc') > 1,
    'bị 403 thì phải thử thêm referer, thấy: ' + perHost.get('images.truyenonline.cc'));
});

test('vẫn lấy được ảnh khi host đầu chết nhưng host dự phòng sống', async () => {
  const a = await authedProxy(async (u) => {
    if (new URL(u).hostname === 'images.truyenonline.cc') throw new Error('chết');
    return { ok: true, status: 200, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new Uint8Array([7]).buffer };
  });
  const res = await a.get('/img?i=' + packImg(MIRRORED));
  assert.equal(res.status, 200);
});
