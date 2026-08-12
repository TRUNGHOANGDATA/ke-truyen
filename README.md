# Kệ Truyện — web đọc truyện tranh cá nhân

Web đọc truyện tranh tiếng Việt, **không quảng cáo**, dùng riêng (đăng nhập bằng mật khẩu).
Ảnh đi qua proxy có cache. Chạy 24/7 miễn phí trên Oracle Cloud Always Free.

## Nguồn truyện

Chọn bằng biến `SOURCE` trong `.env`:

| `SOURCE` | Nguồn | Tình trạng |
|---|---|---|
| `truyenqq` (mặc định) | TruyenQQ, crawl HTML | **Cập nhật từng phút** |
| `otruyen` | OTruyen API | Đã ngừng nạp chương mới từ 11/06/2026 |

Đổi nguồn thì slug truyện khác nhau, nên thư viện (truyện theo dõi, vị trí đọc) coi như
bắt đầu lại. Chi tiết trong tài liệu thiết kế, mục 5b.

## Lưu offline lên Google Drive (không bắt buộc)

Mặc định web **không lưu ảnh** — chỉ lưu mục lục + vị trí đọc, ảnh lấy trực tiếp từ nguồn
và cache tạm 2 GB trên đĩa. Nếu nguồn chết thì thư viện thành danh sách trỏ vào chỗ trống
(đã xảy ra một lần với nguồn cũ).

Bật lưu offline để giữ ảnh vĩnh viễn trên Drive của bạn:

**Dung lượng thực đo:** trung bình **~9 MB/chương**. Một bộ manhwa 111 chương ≈ 1,1 GB;
một bộ manhua dài 1.281 chương ≈ 14 GB. **2 TB chứa được ~230.000 chương** — thoải mái.

**Cài một lần:**

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo project mới
2. *APIs & Services → Library* → bật **Google Drive API**
3. *OAuth consent screen* → chọn **External** → điền tên app + email → Save
4. **Quan trọng: bấm "PUBLISH APP" để chuyển trạng thái sang "In production".**
   - Nếu để nguyên **"Testing"**, Google cho refresh token **hết hạn sau 7 ngày** → cứ ~1 tuần web mất kết nối Drive, phải chạy lại `drive:auth`.
   - Web chỉ xin quyền `drive.file` (không nhạy cảm) nên publish **không cần Google xét duyệt** — bấm là xong ngay.
5. *Credentials → Create credentials → OAuth client ID* → loại **Desktop app** → copy Client ID + Client secret
5. Lấy refresh token (bạn tự bấm đồng ý trên trang Google, script không thấy mật khẩu của bạn):
   ```bash
   node scripts/drive-auth.js <CLIENT_ID> <CLIENT_SECRET>
   ```
   > Lúc bấm đồng ý, app chưa được Google xác minh nên hiện màn hình cảnh báo:
   > bấm **"Advanced" → "Go to … (unsafe)"**. Đây là app của chính bạn nên an toàn.
6. Dán 3 dòng `DRIVE_*` mà script in ra vào `.env`
7. Kiểm tra kết nối:
   ```bash
   npm run drive:check
   ```

Nếu một ngày `drive:check` báo lỗi *invalid_grant* / token bị thu hồi (thường do quên
publish app, hoặc bạn đổi mật khẩu Google), chỉ cần chạy lại bước 5–6 để lấy token mới.

**Dùng:** vào trang một truyện → bấm **⬇ Lưu offline**. Thanh tiến trình hiện số chương và
dung lượng; bấm lại để dừng, bấm nữa để tiếp tục đúng chỗ dở (ảnh đã lưu không tải lại).
Ảnh xếp trên Drive theo `truyen/<slug>/<chương>/000.jpg`.

Khi đọc, web lấy ảnh theo thứ tự: **cache đĩa → Drive → nguồn gốc**. Nên chương đã lưu vẫn
đọc được dù nguồn có sập. Xem dung lượng đã dùng ở trang **Tình trạng**.

Chỉ xin quyền `drive.file` — web chỉ thấy được file do chính nó tạo, không đọc được dữ liệu
khác trong Drive của bạn.

## Chạy thử trên máy (dev)

```bash
npm install
cp .env.example .env
# tạo hash mật khẩu và dán vào .env (PASSWORD_HASH=)
node scripts/hash-password.js 'E521satan'
node --env-file=.env src/server.js
# mở http://localhost:3000  (mật khẩu: E521satan)
```

Chạy test: `npm test` · Kiểm tra API thật: `node --env-file=.env scripts/smoke-live.js`

## Triển khai lên VPS (Oracle Always Free)

1. Trỏ **A-record** của tên miền về IP máy chủ.
2. Trên VPS:
   ```bash
   git clone <repo> web-truyen && cd web-truyen
   DOMAIN=truyen.example.com ./scripts/setup-server.sh
   ```
3. Tạo hash mật khẩu và dán vào `.env`:
   ```bash
   docker compose run --rm app node scripts/hash-password.js 'E521satan'
   ```
   Mở `.env`, đặt `PASSWORD_HASH=...` và `DOMAIN=...`.
4. Chạy lại: `DOMAIN=truyen.example.com ./scripts/setup-server.sh`
5. Mở `https://truyen.example.com`, đăng nhập, rồi vào **Cài đặt → Đổi mật khẩu**.

Caddy tự xin và gia hạn chứng chỉ HTTPS (Let's Encrypt).

## Khôi phục / rebuild

Mọi dữ liệu (truyện theo dõi, vị trí đọc) nằm trong `./data` (kèm backup hằng đêm ở `./data/backups`).
Nếu máy bị thu hồi, dựng máy mới và chạy lại `setup-server.sh` — dữ liệu còn nguyên nếu giữ được thư mục `data`.
Toàn bộ đóng gói Docker nên chạy được trên bất kỳ VPS free nào khác, không khoá vào Oracle.

## Kiến trúc

Một tiến trình Node.js (Express) phục vụ trang EJS + API JSON; `better-sqlite3` lưu trạng thái;
tầng `ComicSource` (`src/source/`) bọc OTruyen API để dễ đổi nguồn; proxy ảnh (`src/routes/image.js`)
gắn `Referer`, cache LRU trên đĩa. Không có lịch crawl nền — chỉ gọi nguồn khi người dùng thao tác.

Xem thiết kế chi tiết: `docs/superpowers/specs/2026-08-11-web-truyen-design.md`.
