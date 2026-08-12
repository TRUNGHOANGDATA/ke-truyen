/**
 * Tự kiểm tra kết nối Google Drive: upload 1 file nhỏ, đọc lại, rồi xoá đi.
 * Chạy: npm run drive:check
 */
import { createDrive } from '../src/storage/drive.js';
import { config } from '../src/config.js';

const drive = createDrive({
  clientId: config.DRIVE_CLIENT_ID,
  clientSecret: config.DRIVE_CLIENT_SECRET,
  refreshToken: config.DRIVE_REFRESH_TOKEN,
  rootFolderId: config.DRIVE_FOLDER_ID,
});

let fail = 0;
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) fail++;
};

if (!drive.configured) {
  console.error('✗ Chưa cấu hình. Cần DRIVE_CLIENT_ID / DRIVE_CLIENT_SECRET / DRIVE_REFRESH_TOKEN trong .env');
  console.error('  Lấy bằng: node scripts/drive-auth.js <CLIENT_ID> <CLIENT_SECRET>');
  process.exit(1);
}

try {
  await drive.token();
  ok('Lấy được access token', true);

  const q = await drive.quota();
  const gb = (b) => (b / 1073741824).toFixed(1);
  ok('Đọc được dung lượng Drive', true,
    `đã dùng ${gb(q.used)} GB${q.total ? ` / ${gb(q.total)} GB (còn ${gb(q.total - q.used)} GB)` : ''}`);

  const folder = await drive.ensureFolder('truyen/_kiem-tra');
  ok('Tạo được thư mục', !!folder);

  const payload = Buffer.from('kiem tra ket noi drive');
  const up = await drive.upload({ name: 'test.txt', parentId: folder, buffer: payload, mimeType: 'text/plain' });
  ok('Upload được file', !!up.id, `id ${up.id}`);

  const back = await drive.download(up.id);
  ok('Đọc lại đúng nội dung', back.buf.toString() === payload.toString());

  await drive.remove(up.id);
  ok('Xoá được file thử', true);
} catch (e) {
  ok('Kết nối Drive', false, e.message);
}

console.log(fail ? `\n${fail} bước THẤT BẠI.` : '\nDrive đã sẵn sàng. Vào trang truyện bấm "Lưu offline".');
process.exit(fail ? 1 : 0);
