# Hướng dẫn deploy — Kệ Truyện

Dành cho một máy chủ Ubuntu bất kỳ (VPS, cloud, máy nhà). Kết quả: web chạy 24/7 tại
`https://truyen.tenmien.com`, HTTPS tự động, tự khởi động lại khi máy reboot.

Thời gian: ~15 phút (phần lớn là chờ build).

---

## 0. Chuẩn bị

- Máy chủ Ubuntu 22.04/24.04, quyền `sudo`, mở được cổng **80** và **443**.
- Một tên miền (hoặc subdomain) và quyền sửa DNS của nó.
- Mật khẩu đăng nhập muốn đặt cho web.

> **Cổng 80/443 phải mở ở CẢ HAI nơi:** tường lửa của nhà cung cấp (Security Group /
> Firewall trong bảng điều khiển) **và** tường lửa trong máy (`ufw` / `iptables`).
> Quên cái thứ nhất là lỗi hay gặp nhất — container chạy ngon mà web không vào được.

---

## 1. Trỏ tên miền về máy chủ

Ở trang quản lý DNS, thêm một bản ghi:

| Loại | Tên | Giá trị |
|---|---|---|
| A | `truyen` (hoặc subdomain bạn muốn) | IP công khai của máy chủ |

Nếu dùng **Cloudflare**: để cột Proxy ở **DNS only** (đám mây xám) cho lần cài đầu, để
Caddy xin được chứng chỉ. Xong xuôi muốn bật proxy lại thì tuỳ.

Kiểm tra đã lan chưa: `ping truyen.tenmien.com` phải ra đúng IP.

---

## 2. Đưa mã nguồn lên máy chủ

Từ máy của bạn (thư mục chứa gói này):

```bash
scp -r ./ke-truyen-deploy user@IP-MAY-CHU:~/ke-truyen
```

Rồi SSH vào: `ssh user@IP-MAY-CHU` và `cd ~/ke-truyen`.

> Nếu bạn giải nén từ file **`.zip`**: định dạng zip không giữ cờ thực thi, nên các lệnh
> dưới đây gọi script bằng `bash scripts/...` cho chắc. Muốn gọi kiểu `./scripts/...` thì
> chạy `chmod +x scripts/*.sh` một lần. Dùng bản **`.tar.gz`** thì cờ thực thi còn nguyên.

*(Nếu bạn đẩy gói này lên một Git repo **riêng tư** thì `git clone` cũng được — tuyệt đối
không đẩy file `.env` lên repo, nó chứa mật khẩu và token.)*

---

## 3. Cài Docker + tạo file cấu hình

```bash
DOMAIN=truyen.tenmien.com bash scripts/setup-server.sh
```

Lần chạy đầu script sẽ: cài Docker (nếu chưa có) → tạo `.env` từ `.env.example` → tự sinh
`SESSION_SECRET` ngẫu nhiên → **dừng lại** và nhắc bạn điền nốt. Đó là hành vi đúng.

### 3b. Máy 1 GB RAM: bật swap trước

`better-sqlite3` biên dịch native, 1 GB RAM sẽ bị OOM khi build. Máy ≥ 2 GB thì bỏ qua bước này.

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 4. Tạo mật khẩu đăng nhập

Mật khẩu **không bao giờ** lưu dạng chữ thường — chỉ lưu hash bcrypt.

```bash
docker compose run --rm app node scripts/hash-password.js 'mat-khau-ban-chon'
```

Copy dòng hash in ra (dạng `$2a$10$...`).

---

## 5. Điền `.env`

```bash
nano .env
```

Bắt buộc:

```ini
DOMAIN=truyen.tenmien.com
PASSWORD_HASH=$2a$10$...        # dán y nguyên hash ở bước 4
SESSION_SECRET=...              # script đã tự sinh, để nguyên
```

Tuỳ chọn — chỉ khi muốn lưu ảnh lên Google Drive (xin 3 dòng này từ chủ web, hoặc tự tạo
theo mục "Lưu offline" trong [README.md](README.md)):

```ini
DRIVE_CLIENT_ID=...
DRIVE_CLIENT_SECRET=...
DRIVE_REFRESH_TOKEN=...
DRIVE_FOLDER_ID=root
```

> ⚠️ **Không bọc `PASSWORD_HASH` trong dấu nháy, không sửa dấu `$`.** File này được đọc bằng
> `node --env-file` (đọc nguyên văn) chứ không qua `env_file:` của Docker Compose — cố tình
> như vậy, vì Compose nội suy dấu `$` làm hỏng hash → đăng nhập luôn 401.

Lưu: `Ctrl+O`, `Enter`, `Ctrl+X`.

---

## 6. Bật web

```bash
DOMAIN=truyen.tenmien.com bash scripts/setup-server.sh
```

Lần này script mở cổng 80/443 trên tường lửa máy, build image rồi bật app + Caddy.
Build lần đầu ~2–5 phút.

Mở `https://truyen.tenmien.com` → nhập mật khẩu ở bước 4. Xong.

Kiểm tra nhanh không cần đăng nhập: `curl -I https://truyen.tenmien.com/healthz` → `200`.

---

## Chuyển dữ liệu từ máy cũ (nếu có)

Thư viện, vị trí đọc, lịch sử đều nằm gọn trong `data/app.db`. Ảnh đã cache ở `cache/` —
không cần chuyển, tự tải lại được.

Trên máy cũ, **tắt app trước** để SQLite ghi nốt WAL:

```bash
docker compose stop app
tar czf data-cu.tar.gz data/
```

Chép sang máy mới, rồi tại `~/ke-truyen`:

```bash
docker compose stop app
tar xzf data-cu.tar.gz
docker compose start app
```

Nếu tài khoản Google Drive vẫn là của chủ web thì các chương đã lưu offline nhận lại được
ngay, miễn 3 dòng `DRIVE_*` trong `.env` giống máy cũ.

---

## Vận hành hằng ngày

```bash
docker compose ps                  # trạng thái
docker compose logs -f app         # log ứng dụng
docker compose logs -f caddy       # log HTTPS/chứng chỉ
docker compose restart app         # khởi động lại app
docker compose down                # tắt hẳn
```

**Cập nhật code mới:**

```bash
cd ~/ke-truyen
# đẩy code mới lên (scp / git pull) — KHÔNG đè lên .env, data/, cache/
docker compose up -d --build
```

**Sao lưu:** chỉ cần copy thư mục `data/` đi nơi khác. Không có gì khác cần giữ.

**Đổi mật khẩu:** đăng nhập → trang **Cài đặt** → mục đổi mật khẩu → nó in ra hash mới →
dán vào `PASSWORD_HASH=` trong `.env` → `docker compose restart app`. (Cố ý làm thủ công:
app không tự ghi đè file cấu hình.)

---

## Khi nguồn truyện đổi tên miền

Nguồn (TruyenQQ) hay nhảy tên miền. Web tự dò danh sách mirror và ghi nhớ domain còn sống,
nên phần lớn trường hợp tự khỏi. Nếu không: vào trang **Cài đặt** → *"↻ Tự dò lại ngay"*,
hoặc nhập tay domain mới rồi *Kiểm tra & lưu*. Không cần khởi động lại container.

---

## Sự cố thường gặp

**Web không vào được dù `docker compose ps` báo đang chạy**
Gần như luôn là tường lửa. Kiểm tra Security Group/Firewall ở bảng điều khiển nhà cung cấp
đã mở 80/443 chưa, rồi `sudo iptables -L INPUT -n | grep -E '80|443'`.

**Không xin được chứng chỉ HTTPS**
`docker compose logs caddy`. Thường do DNS chưa trỏ đúng IP, hoặc cổng **80** bị chặn
(Caddy cần cổng 80 để xác thực). Sửa xong Caddy tự thử lại, hoặc `docker compose restart caddy`.

**Đăng nhập báo sai mật khẩu dù chắc chắn đúng**
`PASSWORD_HASH` trong `.env` bị hỏng — kiểm tra không có dấu nháy bao quanh, dấu `$` còn
nguyên, và hash nằm gọn trên **một dòng**.

**Build lỗi / máy treo lúc `docker compose build`**
Hết RAM khi biên dịch `better-sqlite3` → bật swap (mục 3b).

**App crash `ERR_MODULE_NOT_FOUND ... src/cache/...`**
Do lúc đóng gói `tar` đã lỡ loại luôn thư mục `src/cache/`. Khi tự tạo tarball phải neo
exclude ở gốc: `--exclude=./cache --exclude=./data`, **không** dùng `--exclude=cache`.

**Ảnh không hiện, chữ thì có**
Nguồn đã đổi CDN. Host ảnh được duyệt khai báo trong `IMAGE_HOSTS` ở
[src/config.js](src/config.js) — thêm host mới vào đó rồi `docker compose up -d --build`.

---

## Chạy không cần Docker (tuỳ chọn)

```bash
npm install                 # cần build-essential + python3 cho better-sqlite3
cp .env.example .env        # rồi điền như mục 5
node --env-file=.env src/server.js     # http://localhost:3000
```

Chạy kiểu này thì tự lo reverse proxy + HTTPS (nginx/Caddy) và trình quản lý tiến trình
(systemd/pm2). Bản Docker đã làm sẵn hết những việc đó.
