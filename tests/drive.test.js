import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrive } from '../src/storage/drive.js';

/** Drive giả: ghi lại request, trả JSON theo từng endpoint */
function fakeDrive({ folders = {}, files = {}, quota } = {}) {
  const calls = [];
  let tokenCount = 0;
  const nextId = (() => { let n = 0; return (p) => `${p}${++n}`; })();

  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body: init.body });

    if (u.includes('oauth2.googleapis.com/token')) {
      tokenCount++;
      return json({ access_token: 'tok-' + tokenCount, expires_in: 3600 });
    }
    if (u.includes('/upload/drive/v3/files')) {
      const id = nextId('file-');
      return json({ id, size: 1234 });
    }
    if (u.includes('/about')) {
      return json({ storageQuota: quota || { usage: '5000', limit: '2199023255552' } });
    }
    if (u.includes('/files?q=')) {
      const q = decodeURIComponent(u.split('/files?q=')[1].split('&')[0]);
      const m = q.match(/name='([^']+)'/);
      const name = m ? m[1] : '';
      const hit = folders[name];
      return json({ files: hit ? [{ id: hit, name }] : [] });
    }
    if (u.match(/\/files\/[^/?]+\?alt=media/)) {
      const id = u.split('/files/')[1].split('?')[0];
      return bin(files[id] || Buffer.from('img-' + id));
    }
    if (init.method === 'POST' && u.includes('/files?fields=id')) {
      return json({ id: nextId('folder-') });
    }
    if (init.method === 'DELETE') return json({});
    return json({});
  };

  const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o), headers: new Map() });
  // Buffer của Node dùng vùng nhớ chung, phải cắt đúng phần dữ liệu
  const bin = (b) => ({
    ok: true, status: 200,
    arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
    headers: { get: () => 'image/jpeg' },
  });

  return { fetchFn, calls, tokenCount: () => tokenCount };
}

const creds = { clientId: 'cid', clientSecret: 'sec', refreshToken: 'ref' };

test('chưa cấu hình thì configured=false và gọi là báo lỗi rõ ràng', async () => {
  const d = createDrive({});
  assert.equal(d.configured, false);
  await assert.rejects(() => d.quota(), /Chưa cấu hình Google Drive/);
});

test('đổi refresh token thành access token, và dùng lại token còn hạn', async () => {
  const f = fakeDrive();
  const d = createDrive({ ...creds, fetchFn: f.fetchFn });
  await d.quota();
  await d.quota();
  assert.equal(f.tokenCount(), 1, 'chỉ nên xin token một lần khi còn hạn');
});

test('xin token mới khi token cũ hết hạn', async () => {
  const f = fakeDrive();
  let t = 1_000_000;
  const d = createDrive({ ...creds, fetchFn: f.fetchFn, now: () => t });
  await d.quota();
  t += 3600_000 + 1;   // qua thời điểm hết hạn
  await d.quota();
  assert.equal(f.tokenCount(), 2);
});

test('ensureFolder tạo thư mục còn thiếu và nhớ lại (không gọi lặp)', async () => {
  const f = fakeDrive({ folders: { truyen: 'folder-truyen' } });
  const d = createDrive({ ...creds, fetchFn: f.fetchFn });
  const id1 = await d.ensureFolder('truyen/abc/12');
  const before = f.calls.length;
  const id2 = await d.ensureFolder('truyen/abc/12');
  assert.equal(id1, id2);
  assert.equal(f.calls.length, before, 'lần hai phải lấy từ cache');
});

test('upload gửi multipart kèm tên file và thư mục cha', async () => {
  const f = fakeDrive();
  const d = createDrive({ ...creds, fetchFn: f.fetchFn });
  const out = await d.upload({ name: '000.jpg', parentId: 'p1', buffer: Buffer.from('abc'), mimeType: 'image/jpeg' });
  assert.equal(out.id, 'file-1');
  const call = f.calls.find(c => c.url.includes('/upload/'));
  assert.match(call.headers['Content-Type'], /multipart\/related; boundary=/);
  const body = call.body.toString();
  assert.match(body, /"name":"000\.jpg"/);
  assert.match(body, /"parents":\["p1"\]/);
  assert.match(body, /image\/jpeg/);
});

test('download trả buffer và content-type', async () => {
  const f = fakeDrive({ files: { 'file-x': Buffer.from('noi-dung-anh') } });
  const d = createDrive({ ...creds, fetchFn: f.fetchFn });
  const { buf, contentType } = await d.download('file-x');
  assert.equal(buf.toString(), 'noi-dung-anh');
  assert.equal(contentType, 'image/jpeg');
});

test('quota đọc dung lượng đã dùng và tổng', async () => {
  const f = fakeDrive({ quota: { usage: '1073741824', limit: '2199023255552' } });
  const d = createDrive({ ...creds, fetchFn: f.fetchFn });
  const q = await d.quota();
  assert.equal(q.used, 1073741824);
  assert.equal(q.total, 2199023255552);
});

test('báo lỗi rõ khi refresh token sai', async () => {
  const d = createDrive({
    ...creds,
    fetchFn: async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Token đã bị thu hồi' }) }),
  });
  await assert.rejects(() => d.quota(), /Token đã bị thu hồi/);
});
