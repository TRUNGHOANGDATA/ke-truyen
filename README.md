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
