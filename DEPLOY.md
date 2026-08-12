# Đưa web lên chạy 24/7 miễn phí (Oracle Cloud Always Free)

Hướng dẫn từ số 0 cho người không rành kỹ thuật. Làm **một lần**, sau đó web chạy
24/7 kể cả khi tắt máy tính, truy cập được từ iPhone/mọi nơi qua `https://truyen.tenmien-cua-ban`.

Toàn bộ **miễn phí** — Oracle Always Free không hết hạn, không tự trừ tiền (chỉ cần
thẻ để xác minh danh tính lúc đăng ký).

> Mỗi khi xong một PHẦN, báo lại (nhất là **IP máy chủ**) để mình dẫn tiếp phần sau.

---

## Cần chuẩn bị
- 1 thẻ Visa/Mastercard (chỉ để xác minh, không bị trừ tiền cho gói Always Free).
- Tên miền của bạn + quyền vào trang quản lý DNS của nó.
- Máy tính để làm các bước cài đặt (Windows đều được).

---

## PHẦN 1 — Tạo tài khoản Oracle Cloud

1. Vào https://www.oracle.com/cloud/free/ → bấm **Start for free**.
2. Điền email, quốc gia **Vietnam**, xác minh email.
3. Chọn **Account type: Individual**, điền tên, số điện thoại (xác minh OTP).
4. Nhập thẻ để xác minh (Oracle giữ ~1 USD rồi hoàn lại; gói Free không bị trừ).
5. Chọn **Home Region**: nên chọn khu vực gần VN — **Singapore** hoặc **Japan (Tokyo)**.
   ⚠️ Home Region **không đổi được sau này**, chọn kỹ.
6. Xong → đăng nhập vào **Oracle Cloud Console** (https://cloud.oracle.com).

---

## PHẦN 2 — Tạo máy chủ (VM Instance)

1. Console → menu ☰ → **Compute → Instances** → **Create instance**.
2. **Name**: đặt gì cũng được, ví dụ `ke-truyen`.
3. **Image and shape** → **Edit**:
   - **Image**: chọn **Canonical Ubuntu 22.04**.
   - **Shape** → **Change shape**:
     - Ưu tiên **Ampere (ARM)**: `VM.Standard.A1.Flex`, đặt **1 OCPU / 6 GB RAM**
       (nằm trong hạn mức Always Free). Máy này khỏe, chạy mượt.
     - Nếu báo **"Out of capacity"** (ARM hay hết chỗ): đổi sang
       **VM.Standard.E2.1.Micro** (AMD, 1 OCPU / 1 GB) — luôn có sẵn, vẫn chạy được.
       (Xem mục Sự cố nếu vẫn hết chỗ.)
4. **Networking**: để mặc định (tự tạo VCN mới). Đảm bảo **Assign a public IPv4 address = Yes**.
5. **Add SSH keys**:
   - Chọn **Generate a key pair for me** → bấm **Save private key** (tải file `.key` về máy,
     GIỮ KỸ — đây là chìa khóa vào máy chủ) và **Save public key**.
   - (Hoặc nếu bạn đã có sẵn key thì dán public key vào.)
6. Bấm **Create**. Chờ ~1 phút tới khi trạng thái **RUNNING**.
7. Ghi lại **Public IP address** hiện trên trang instance. 👉 **Gửi IP này cho mình.**

---

## PHẦN 3 — Mở cổng mạng (rất quan trọng)

Cần mở cổng **80** và **443** ở 2 nơi. Nơi thứ 2 (tường lửa trong máy) script tự làm hộ;
nơi thứ nhất phải bấm tay trong Console:

1. Trang instance → mục **Primary VNIC** → bấm vào **Subnet** đang dùng.
2. Trong Subnet → **Security Lists** → bấm vào **Default Security List**.
3. **Add Ingress Rules**, thêm 2 luật (mỗi luật một dòng):
   - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port **80**
   - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port **443**
4. Lưu lại.

---

## PHẦN 4 — Trỏ tên miền về máy chủ

Ở trang quản lý DNS của tên miền bạn (Cloudflare / nhà bán tên miền), thêm một bản ghi:

| Loại | Tên (Name/Host) | Giá trị (Value) |
|------|-----------------|-----------------|
| A    | `truyen` (hoặc subdomain bạn muốn) | **IP máy chủ ở Phần 2** |

- Kết quả: `truyen.tenmien.com` → IP máy chủ.
- Nếu dùng **Cloudflare**: đặt cột Proxy về **DNS only** (đám mây xám), để Caddy tự xin
  HTTPS được. Sau khi chạy ổn có thể bật lại proxy nếu muốn.
- DNS có thể mất vài phút tới vài giờ để lan. Kiểm tra bằng cách ping tên miền.

👉 **Cho mình biết: domain của bạn, subdomain muốn dùng, DNS quản ở đâu** — mình soạn
đúng các ô cần điền.

---

## PHẦN 5 — Đưa mã nguồn + cấu hình lên máy chủ

### 5a. Kết nối vào máy chủ bằng SSH (từ Windows)
Mở **PowerShell** trên máy bạn, thay `duong-dan-key.key` và `IP`:
```bash
ssh -i "C:\duong-dan\den\key.key" ubuntu@IP-MAY-CHU
```
Lần đầu gõ `yes`. Vào được là thấy dòng lệnh `ubuntu@...:~$`.

> Nếu báo lỗi quyền file key trên Windows: chuột phải file `.key` → Properties →
> Security → chỉ để tài khoản của bạn có quyền (bỏ Inherited). Mình chỉ chi tiết nếu cần.

### 5b. Lấy code về máy chủ
Vì `.env` chứa mật khẩu + token Drive nên **không đẩy lên GitHub công khai**. Hai cách:

**Cách A — GitHub repo riêng tư (khuyên dùng, cập nhật sau dễ):**
mình sẽ giúp bạn tạo repo private và đẩy code. Trên máy chủ chỉ cần:
```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://<token>@github.com/<ban>/<repo>.git ke-truyen
cd ke-truyen
```

**Cách B — Chép thẳng từ máy bạn (không cần GitHub):**
Trên PowerShell **máy bạn** (không phải máy chủ), tại thư mục dự án:
```bash
scp -i "key.key" -r "H:\Web Truyen Chu" ubuntu@IP:~/ke-truyen
```

### 5c. Tạo file cấu hình `.env` trên máy chủ
Trong thư mục `ke-truyen` trên máy chủ:
```bash
cp .env.example .env
nano .env
```
Điền các dòng sau rồi lưu (Ctrl+O, Enter, Ctrl+X):
- `DOMAIN=truyen.tenmien.com`  (subdomain thật của bạn)
- `SESSION_SECRET=` một chuỗi ngẫu nhiên dài (script cũng tự tạo nếu để trống)
- `PASSWORD_HASH=` lấy ở bước 6
- `DRIVE_CLIENT_ID=`, `DRIVE_CLIENT_SECRET=`, `DRIVE_REFRESH_TOKEN=`
  → **copy y nguyên 3 dòng này từ file `.env` trên máy bạn** (đã có sẵn).

---

## PHẦN 6 — Bật web lên (một lệnh)

Trong thư mục `ke-truyen` trên máy chủ:

```bash
# Tạo mã băm cho mật khẩu đăng nhập E521satan:
docker compose run --rm app node scripts/hash-password.js 'E521satan'
```
Copy dòng kết quả dán vào `PASSWORD_HASH=` trong `.env` (bước 5c). Rồi:

```bash
DOMAIN=truyen.tenmien.com ./scripts/setup-server.sh
```
Lần đầu script cài Docker xong sẽ dừng lại nhắc điền `.env`; điền xong **chạy lại đúng
lệnh trên**. Lần này nó sẽ:
- mở cổng tường lửa 80/443,
- build và bật app + Caddy,
- Caddy tự xin chứng chỉ HTTPS (Let's Encrypt).

Chờ ~1–2 phút rồi mở `https://truyen.tenmien.com` trên điện thoại/máy tính → nhập mật
khẩu `E521satan`. Xong!

---

## Cập nhật web sau này
Khi mình sửa/thêm tính năng, trên máy chủ:
```bash
cd ke-truyen
git pull            # nếu dùng Cách A; hoặc scp lại nếu Cách B
docker compose up -d --build
```
Dữ liệu (truyện đang đọc, ảnh cache) nằm trong thư mục `data/` và `cache/` nên không mất
khi cập nhật.

---

## Sự cố thường gặp

**"Out of host capacity" khi tạo VM ARM**
ARM Always Free hay hết chỗ theo giờ. Cách xử lý:
- Đổi **Availability Domain** (AD-1/AD-2/AD-3) khi tạo, thử lần lượt.
- Hoặc dùng **E2.1.Micro** (AMD) — luôn có sẵn.
- Hoặc thử lại vào giờ thấp điểm.

**Web không vào được dù container đã chạy**
- Kiểm tra đã thêm Ingress Rule 80/443 ở **Phần 3** chưa (hay quên nhất).
- Kiểm tra DNS đã trỏ đúng IP chưa (`ping truyen.tenmien.com`).
- Xem log: `docker compose logs -f caddy` và `docker compose logs -f app`.

**Chứng chỉ HTTPS lỗi**
- Thường do DNS chưa trỏ đúng, hoặc cổng 80 chưa mở (Caddy cần cổng 80 để xin cert).
- Sửa xong chờ Caddy tự thử lại, hoặc `docker compose restart caddy`.

**Quên/không vào được SSH**
- Đúng file private key `.key` tải ở Phần 2, user là `ubuntu`, đúng IP.
```
