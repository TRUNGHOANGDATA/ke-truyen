# Trang Cài đặt nguồn + tự bắt domain TruyenQQ

Ngày: 2026-08-12

## Mục tiêu
- Web lấy truyện trực tiếp từ TruyenQQ khi đọc (đã có), **không phụ thuộc** vào lưu offline.
- Khi TruyenQQ đổi tên miền, web **tự dò** domain sống trong danh sách dự phòng, **ghi nhớ** làm domain chính (phương án C), không cần khởi động lại.
- Trang **Cài đặt** (khóa sau mật khẩu) để: chọn nguồn (TruyenQQ / OTruyen) và xem/sửa domain TruyenQQ thủ công.
- Không đụng tới tính năng Lưu offline (Drive).

## Kiến trúc

### 1. `settings` service (`src/services/settings.js`)
Bọc bảng `settings(key, value)` sẵn có.
- `get(key, fallback)`, `set(key, value)`, `all()`.
- `seedDefaults()`: nếu thiếu key thì nạp từ `.env` một lần — `source` ← `config.SOURCE`, `truyenqq_base` ← `config.TRUYENQQ_BASE`.
- DB là nguồn chân lý lúc chạy; `.env` chỉ là giá trị khởi tạo.

### 2. `domainResolver` (`src/source/domain-resolver.js`)
- Đầu vào: `{ settings, candidates, fetchFn, probePath='/doc-truyen', validate, timeoutMs=8000 }`.
- `candidates`: `config.TRUYENQQ_MIRRORS` — domain hiện lưu đứng đầu, kèm danh sách mirror cài sẵn (khử trùng lặp).
- `current()`: domain đang dùng (khởi tạo từ `settings.get('truyenqq_base')`).
- `async reprobe()`: thử lần lượt từng candidate → `fetchFn(cand+probePath)` (có timeout). Cái đầu tiên `res.ok` và `validate(html)` đúng thì: gán `current`, `settings.set('truyenqq_base', cand)`, trả về. Hết mà không có → ném lỗi.
- `setCurrent(base)`: dùng khi sửa tay ở trang Cài đặt.
- `validate(html)`: nhận diện trang TruyenQQ (có link `/truyen-tranh/` và cấu trúc HTML hợp lệ).

### 3. Sửa `createTruyenQQSource` để đổi domain không cần restart
- Giữ `base` là biến `let` (đã vậy), thêm:
  - Tham số `reprobe` (async → domain mới) — tùy chọn.
  - Phương thức `setBase(nb)` — cho sửa tay.
- `fetchText`: nếu vòng retry hiện tại thất bại hết **và** có `reprobe` → gọi `reprobe()`; nếu trả domain mới khác domain cũ thì đổi URL sang domain mới (`nb + url.slice(base.length)`), cập nhật `base`, **thử lại một lần**. Vẫn lỗi thì ném như cũ.

### 4. `sourceManager` (trong `src/app.js`)
Cho phép đổi nguồn/domain lúc chạy mà không restart, không phải sửa nơi khác giữ tham chiếu `source`.
- Dựng nguồn theo `settings.get('source')`:
  - `truyenqq` → `withCache(db, createTruyenQQSource({ base: resolver.current(), reprobe: resolver.reprobe }))`
  - `otruyen` → `withCache(db, createSource({ base, cdnBase }))`
- Trả về **facade (Proxy)** ủy quyền mọi phương thức về nguồn hiện hành → truyền cho routes/archive/api.
- `setSource(name)`: dựng lại nguồn, **xóa `api_cache`** (tránh trộn dữ liệu 2 nguồn).
- `applyDomain(base)`: `settings.set`, `resolver.setCurrent`, gọi `setBase` trên nguồn TruyenQQ đang chạy, xóa `api_cache`.
- Khi `deps.source` được inject (test) thì bỏ qua manager, dùng thẳng inject.

### 5. Route + view Cài đặt
- Đổi route `GET /settings` (đang là trang đổi mật khẩu) → gộp thêm phần Nguồn, hoặc thêm khối vào view `settings.ejs` hiện có (khóa sau `requireAuth` — đã có sẵn vì mọi thứ dưới `requireAuth`).
- `GET /settings`: hiện nguồn hiện tại, domain đang sống, danh sách mirror + đánh dấu cái đang dùng.
- `POST /settings/source`: đổi nguồn → `sourceManager.setSource`.
- `POST /settings/domain`: nhận domain → **kiểm tra sống trước** (probe + validate); sống thì `applyDomain`, không thì báo lỗi, không lưu.
- Thêm mục **"Cài đặt"** vào sidebar "Khám phá" (partial header/sidebar).

## Xử lý lỗi
- Mọi domain chết: `reprobe()` ném lỗi → nguồn ném lỗi → `withCache` trả trang cache cũ (đã có stale-fallback); trang hiện thông báo nếu không có cache.
- Domain nhập tay không hợp lệ/chết: từ chối lưu, giữ domain cũ, báo lỗi rõ.

## Kiểm thử
- `settings`: get/set/all; `seedDefaults` chỉ nạp khi thiếu key.
- `domainResolver`: chọn domain sống đầu tiên; bỏ qua domain lỗi/không-phải-TruyenQQ; ghi nhớ vào settings; ném lỗi khi tất cả chết.
- `createTruyenQQSource` + reprobe: request domain cũ lỗi → reprobe trả domain mới → thử lại thành công (fetch giả theo domain).
- Route `/settings`: chưa đăng nhập → 401 (kế thừa requireAuth); `POST /settings/domain` domain sống → lưu; domain rác → từ chối (không đổi settings).
- `sourceManager.setSource`: đổi nguồn xóa cache; facade ủy quyền đúng.

## Ngoài phạm vi
- Lưu offline / Drive: giữ nguyên.
- Tự động phát hiện mirror mới ngoài danh sách cài sẵn: không làm (chỉ dò trong danh sách + cho nhập tay).
