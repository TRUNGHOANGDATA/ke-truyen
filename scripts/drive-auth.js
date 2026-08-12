/**
 * Lấy DRIVE_REFRESH_TOKEN cho Google Drive.
 *
 * Chạy:  node scripts/drive-auth.js <CLIENT_ID> <CLIENT_SECRET>
 *
 * Script chỉ in ra link để BẠN tự bấm đồng ý trên trang Google, rồi bạn dán
 * lại mã. Mình không chạm vào mật khẩu Google của bạn.
 */
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error('Dùng: node scripts/drive-auth.js <CLIENT_ID> <CLIENT_SECRET>');
  console.error('\nCách lấy CLIENT_ID / CLIENT_SECRET:');
  console.error('  1. Vào https://console.cloud.google.com/ → tạo project mới');
  console.error('  2. APIs & Services → Library → bật "Google Drive API"');
  console.error('  3. APIs & Services → OAuth consent screen → chọn External, thêm email của bạn vào Test users');
  console.error('  4. Credentials → Create credentials → OAuth client ID → loại "Desktop app"');
  console.error('  5. Copy Client ID và Client secret rồi chạy lại lệnh này');
  process.exit(1);
}

// Luồng "out-of-band": Google hiện mã, bạn dán lại vào đây
const REDIRECT = 'urn:ietf:wg:oauth:2.0:oob';
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/drive.file',
  access_type: 'offline',
  prompt: 'consent',
}).toString();

console.log('\n1) Mở link này trên trình duyệt và bấm đồng ý:\n');
console.log(authUrl);
console.log('\n2) Google sẽ hiện một mã. Dán mã đó vào đây.\n');

const rl = createInterface({ input, output });
const code = (await rl.question('Mã từ Google: ')).trim();
rl.close();

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: REDIRECT, grant_type: 'authorization_code',
  }).toString(),
});
const body = await res.json();
if (!res.ok || !body.refresh_token) {
  console.error('\nThất bại:', JSON.stringify(body, null, 2));
  console.error('\nMẹo: nếu thiếu refresh_token, thu hồi quyền ở https://myaccount.google.com/permissions rồi chạy lại.');
  process.exit(1);
}

console.log('\nXong. Dán 3 dòng này vào file .env:\n');
console.log(`DRIVE_CLIENT_ID=${clientId}`);
console.log(`DRIVE_CLIENT_SECRET=${clientSecret}`);
console.log(`DRIVE_REFRESH_TOKEN=${body.refresh_token}`);
console.log('\nRồi kiểm tra bằng: npm run drive:check');
