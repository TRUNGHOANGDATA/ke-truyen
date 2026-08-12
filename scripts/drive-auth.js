/**
 * Lấy DRIVE_REFRESH_TOKEN cho Google Drive (luồng loopback cho client Desktop).
 *
 * Chạy:  node scripts/drive-auth.js [CLIENT_ID CLIENT_SECRET]
 *   - Không truyền tham số thì đọc DRIVE_CLIENT_ID/SECRET trong .env.
 *
 * Script mở một cổng localhost tạm để HỨNG mã Google trả về — bạn chỉ cần bấm
 * "Cho phép" trên trang Google. Không đụng tới mật khẩu Google của bạn.
 * Xong sẽ tự ghi DRIVE_REFRESH_TOKEN vào .env.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { config } from '../src/config.js';

const clientId = process.argv[2] || config.DRIVE_CLIENT_ID;
const clientSecret = process.argv[3] || config.DRIVE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Thiếu Client ID / Client secret.');
  console.error('Dùng: node scripts/drive-auth.js <CLIENT_ID> <CLIENT_SECRET>');
  console.error('  hoặc đặt DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET trong .env rồi chạy: npm run drive:auth');
  process.exit(1);
}

const PORT = 4753; // cổng loopback tạm; đăng ký sẵn trong redirect URI nếu Google hỏi
const REDIRECT = `http://127.0.0.1:${PORT}`;

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/drive.file',
  access_type: 'offline',
  prompt: 'consent',
}).toString();

function updateEnv(vars) {
  const path = '.env';
  let text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const [k, v] of Object.entries(vars)) {
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, 'm').test(text)
      ? text.replace(new RegExp(`^${k}=.*$`, 'm'), line)
      : (text.endsWith('\n') || text === '' ? text + line + '\n' : text + '\n' + line + '\n');
  }
  writeFileSync(path, text);
}

async function exchange(code) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: REDIRECT, grant_type: 'authorization_code',
    }).toString(),
  });
  return res.json();
}

console.log('\n=== Nối Google Drive ===\n');
console.log('1) Mở link này trên trình duyệt (nơi bạn đã đăng nhập Google) và bấm "Cho phép":\n');
console.log(authUrl);
console.log('\n   Nếu hiện "app chưa được xác minh": Advanced → Go to … (unsafe) — app của chính bạn.');
console.log(`\n2) Đang chờ Google gọi về http://127.0.0.1:${PORT} … (tối đa 5 phút)\n`);

const done = new Promise((resolve) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, REDIRECT);
    const code = url.searchParams.get('code');
    const err = url.searchParams.get('error');
    if (!code && !err) { res.writeHead(204).end(); return; } // bỏ qua /favicon.ico ...

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    if (err) {
      res.end('<h2>Bị từ chối quyền. Có thể đóng tab này.</h2>');
      console.error('Google trả lỗi:', err);
      server.close(); return resolve(1);
    }
    try {
      const tok = await exchange(code);
      if (!tok.refresh_token) {
        res.end('<h2>Không nhận được refresh token. Xem lại terminal.</h2>');
        console.error('\nThiếu refresh_token. Trả về:', JSON.stringify(tok, null, 2));
        console.error('Mẹo: thu hồi quyền ở https://myaccount.google.com/permissions rồi chạy lại (cần prompt=consent).');
        server.close(); return resolve(1);
      }
      updateEnv({
        DRIVE_CLIENT_ID: clientId,
        DRIVE_CLIENT_SECRET: clientSecret,
        DRIVE_REFRESH_TOKEN: tok.refresh_token,
      });
      res.end('<h2>Xong! Đã lưu vào .env. Có thể đóng tab này và quay lại terminal.</h2>');
      console.log('✓ Đã ghi DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET / DRIVE_REFRESH_TOKEN vào .env');
      console.log('  Kiểm tra: npm run drive:check');
      server.close(); resolve(0);
    } catch (e) {
      res.end('<h2>Lỗi đổi mã lấy token. Xem terminal.</h2>');
      console.error('Lỗi:', e.message);
      server.close(); resolve(1);
    }
  });
  server.listen(PORT, '127.0.0.1');
  setTimeout(() => { server.close(); console.error('Hết 5 phút chờ. Chạy lại lệnh nếu cần.'); resolve(1); }, 5 * 60 * 1000);
});

process.exit(await done);
