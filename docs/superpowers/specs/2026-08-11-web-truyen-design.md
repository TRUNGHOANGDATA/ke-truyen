# Thiết kế: Web đọc truyện cá nhân (không quảng cáo)

**Ngày:** 2026-08-11
**Trạng thái:** Đã chốt thiết kế, chờ lập kế hoạch triển khai

---

## 1. Mục tiêu

Một web đọc truyện tiếng Việt **không quảng cáo**, dùng cho cá nhân (tối đa 2–3 người), truy cập được **mọi lúc mọi nơi** từ iPhone và PC, **chi phí 0 đồng**.

Vấn đề đang giải quyết: các trang truyện hiện có đầy quảng cáo, popup, chuyển hướng; trải nghiệm đọc trên điện thoại kém; phải nhớ nhiều trang khác nhau cho từng bộ truyện.

## 2. Phạm vi

**Giai đoạn 1 — Truyện tranh** (làm trước, vì đã có API sẵn):
- Tìm kiếm, duyệt theo thể loại, xem chi tiết truyện
- Theo dõi truyện, đọc truyện, lưu vị trí đọc
- Kiểm tra chương mới

**Giai đoạn 2 — Truyện chữ** (làm sau, cần crawl):
- Crawl từ các trang truyện chữ tiếng Việt, dọn sạch nội dung, lưu trữ lâu dài

**Không làm** (YAGNI — có thể thêm sau nếu thực sự cần):
- Đăng ký nhiều người dùng, phân quyền, bình luận, đánh giá, mạng xã hội
- Đọc offline truyện tranh (lưu ảnh về máy chủ)
- App native cho iOS
- Đề xuất truyện bằng AI, dịch tự động

## 3. Ràng buộc

| Ràng buộc | Chi tiết |
|---|---|
| Chi phí | **Bắt buộc 0đ.** Không dùng tài khoản có khả năng bị trừ tiền. |
| Hạ tầng | Oracle Cloud **Always Free** (tài khoản free thuần, không nâng Pay-As-You-Go) |
| Thiết bị | iPhone là chính (mobile-first), PC là phụ |
| Vận hành | Người dùng **không đụng tới code**. Không cần bật máy tính cá nhân. |
| Người dùng | 1 người chính, tối đa 2–3 người |
| Tên miền | Người dùng đã có tên miền riêng |

## 4. Kiến trúc

```
     iPhone / PC (trình duyệt, PWA)
            │  HTTPS — tên miền riêng
            ▼
┌────────────────────────────────────────┐
│   VPS Oracle Always Free (ARM)         │
│                                        │
│   ┌──────────────────────────────┐     │
│   │  App Node.js (1 tiến trình)  │     │
│   │  ├── Web UI + API nội bộ     │     │
│   │  ├── OTruyen API client      │     │
│   │  └── Proxy ảnh + cache       │     │
│   └──────────────┬───────────────┘     │
│                  │                     │
│   ┌──────────────▼───────────────┐     │
│   │  SQLite                      │     │
│   │  truyện theo dõi, vị trí đọc,│     │
│   │  cài đặt, cache mục lục      │     │
│   └──────────────────────────────┘     │
│                                        │
│   Cache ảnh trên đĩa (tự dọn, ~2GB)    │
└──────────────────┬─────────────────────┘
                   │ HTTPS
                   ▼
        OTruyen API + CDN ảnh
```

**Nguyên tắc thiết kế:** một tiến trình Node.js duy nhất, chạy trong Docker, không phụ thuộc dịch vụ ngoài nào ngoài API nguồn. Toàn bộ hệ thống **di động được** — cùng bộ Docker chạy trên bất kỳ VPS nào khác hoặc trên máy Windows nếu cần.

**Vì sao Node.js:** một ngôn ngữ cho cả web và tầng gọi API; giai đoạn 2 (crawl truyện chữ) cũng dùng chung hệ sinh thái này.

**Vì sao SQLite:** chỉ 1–3 người dùng, không cần server database riêng; là một file duy nhất nên backup và di chuyển cực dễ.

## 5. Nguồn dữ liệu — OTruyen API

Tài liệu: `https://docs.otruyenapi.com/` · Base URL: `https://otruyenapi.com/v1/api`

Đã kiểm tra thực tế và xác nhận hoạt động (2026-08-11):

| Mục đích | Endpoint | Ghi chú |
|---|---|---|
| Trang chủ nguồn | `GET /home` | truyện mới cập nhật |
| Danh sách | `GET /danh-sach/{type}?page=N` | **26.615 bộ**, 24 bộ/trang |
| Tìm kiếm | `GET /tim-kiem?keyword={q}` | tìm theo tên |
| Thể loại | `GET /the-loai` | **61 thể loại** |
| Theo thể loại | `GET /the-loai/{slug}?page=N` | |
| Chi tiết truyện | `GET /truyen-tranh/{slug}` | mô tả, bìa, **toàn bộ mục lục** |
| Ảnh của chương | `GET {chapter_api_data}` | trả mảng ảnh theo trang |

**Cấu trúc dữ liệu đã xác nhận:**

- Response luôn có dạng `{ status, message, data }`
- Ảnh bìa: `{APP_DOMAIN_CDN_IMAGE}/uploads/comics/{thumb_url}` với CDN là `https://img.otruyenapi.com`
- Mục lục nằm ở `item.chapters[].server_data[]`, mỗi chương có `chapter_name`, `chapter_title`, `chapter_api_data`
- Ảnh trong chương ghép theo: `{domain_cdn}/{chapter_path}/{image_file}`
  Ví dụ đã kiểm tra: một chương trả về 33 trang ảnh, tên file dạng `page_0.jpg`
- Phân trang nằm ở `data.params`: `totalItems`, `totalItemsPerPage`, `currentPage`
- Phát hiện chương mới: dùng `updatedAt` và `chaptersLatest` — **chỉ tốn 1 request/truyện**

**Xử lý phụ thuộc bên ngoài:** API này là dịch vụ miễn phí của bên thứ ba, có thể đổi hoặc ngừng. Vì vậy tầng gọi API được tách riêng thành một module có giao diện rõ ràng (`ComicSource`), để nếu phải đổi nguồn thì chỉ viết lại module đó, không ảnh hưởng phần còn lại.

**Gọi API tử tế:** cache metadata trong SQLite (mục lục hết hạn sau 6 giờ), gộp request khi kiểm tra nhiều truyện, tối đa 3 request đồng thời, gặp lỗi thì thử lại có giãn cách.

## 6. Proxy ảnh

Trình duyệt **không tải ảnh trực tiếp từ CDN nguồn**, mà qua endpoint của web mình:

```
GET /img?u={url ảnh đã encode}
```

Lý do:
1. **Vượt chặn hotlink** — proxy gắn đúng header `Referer` khi lấy ảnh
2. **Cache** — ảnh đã xem lưu trên đĩa VPS, xem lại tức thì
3. **Kiểm soát** — lọc bỏ ảnh quảng cáo/logo chèn giữa chương nếu có
4. **Riêng tư** — CDN nguồn không thấy được thiết bị/IP của người đọc

**Bảo vệ:** chỉ cho proxy các domain nằm trong danh sách trắng (`img.otruyenapi.com`, `*.otruyencdn.com`) để endpoint không bị lợi dụng làm proxy mở.

**Quản lý cache:** giới hạn ~2GB, tự xoá ảnh lâu không dùng (LRU). Oracle Always Free có 200GB đĩa nên rất thoải mái.

## 7. Mô hình dữ liệu (SQLite)

```
comics            -- truyện đang theo dõi
  slug (PK), name, thumb_url, status, categories,
  last_chapter_seen, updated_at_source, followed_at

chapters          -- cache mục lục
  comic_slug, chapter_name, chapter_title, api_url,
  order_index, PRIMARY KEY (comic_slug, chapter_name)

reading_progress  -- vị trí đọc
  comic_slug (PK), chapter_name, image_page, updated_at

settings          -- cài đặt người đọc
  key (PK), value

api_cache         -- cache response API
  cache_key (PK), payload, expires_at
```

Vị trí đọc lưu ở server (không phải trong trình duyệt) → **đọc tiếp đúng chỗ khi đổi giữa iPhone và PC**.

## 8. Giao diện

Bố cục **theo kiểu TruyenQQ** (trang người dùng quen dùng), nhưng **bỏ toàn bộ quảng cáo, popup, banner, link cá cược**. Chạy tốt cả máy tính và iPhone; bọc thành **PWA** để iPhone "Thêm vào màn hình chính" có icon và chạy toàn màn hình như app.

**Bản mẫu đã chốt:** [mockups/manga-ui.html](mockups/manga-ui.html) — dựng đủ 3 màn hình, cả bố cục máy tính lẫn iPhone, là chuẩn giao diện để code theo.

**Hệ màu & chữ (theo bản mẫu):**
- Nền xám `#EBEBEB`, thẻ trắng, chữ đen, link xanh `#1568C8` — tông sáng như trang gốc
- Màu nhấn đỏ `#FF2853` cho: nút chính, cờ "Hot", số chương mới, mục đang chọn
- Xanh lá `#17A67B` cho trạng thái "đã đọc / bình thường"; trình đọc nền mực `#0B0A0D`
- Có chế độ tối (dark mode) tự theo cài đặt thiết bị
- Phông hệ thống (Segoe UI / SF Pro) — không viết hoa toàn bộ (dấu tiếng Việt xấu); số dùng phông mono căn cột

**Trang chủ:**
- Header: logo + menu (Trang chủ / Thể loại / Xếp hạng / Đang theo dõi / Lịch sử) + ô tìm + tài khoản
- Thanh **61 thể loại** dạng viên, **xuống dòng**, mặc định gọn 2 dòng, nút "Xem tất cả" mở rộng
- **Lưới bìa dày** (thẻ ~150–170px, bìa tỉ lệ 190×247): nhãn thời gian góc trên-trái, cờ "Hot" góc trên-phải, số chương mới nhất chồng đáy bìa, thanh tiến độ đọc
- Sidebar phải: nút **"Kiểm tra chương mới"**, mục **"Đang đọc"**, **"Xếp hạng tuần"**, ô **"Tình trạng hệ thống"**
- Sắp xếp: Mới nhất / Xem nhiều / Theo dõi; phân trang kiểu số
- Trên iPhone: thanh điều hướng đáy (Trang chủ / Theo dõi / Tìm / Lịch sử), lưới 3 cột

**Tìm & thêm truyện:**
- Gõ tên để tìm, hoặc duyệt theo 61 thể loại, hoặc xem danh sách truyện mới
- Xem chi tiết (bìa, mô tả, thể loại, số chương, lượt xem) → bấm "Theo dõi"

**Chi tiết truyện:** bìa lớn + thông tin (tình trạng, cập nhật, thể loại, số chương/chưa đọc/lượt xem), nút "Đọc tiếp / Theo dõi / Đánh dấu đã đọc hết", mô tả, **mục lục dạng lưới nhiều cột** — chương mới màu đỏ, đang đọc tô đậm, đã đọc có dấu ✓ xám.

**Trình đọc truyện tranh:**
- Thanh trên: nút quay lại, tên truyện + chương, **dropdown "nhảy chương"** (phân biệt mới/đang đọc/đã đọc), nút "Chương trước / sau", bảng **"Cách đọc"**
- Bảng "Cách đọc": chế độ (cuộn dọc / lật trang), khổ ảnh (hẹp / vừa / rộng / gốc), nền (mực / xám / giấy), công tắc (tự ẩn thanh công cụ, nạp trước chương sau, tự sang chương khi hết)
- Ảnh giới hạn khổ giữa màn hình trên PC (không kéo giãn méo); nạp dần theo tầm nhìn + nạp trước 3 ảnh kế
- Zoom 2 ngón; nút lật chương hai bên mép; phím tắt trên PC (mũi tên chuyển chương, `F` toàn màn hình)
- **Khối cuối chương**: nút "Chương sau", "Chương trước", "Danh sách chương"; tự đánh dấu chương đã đọc
- Thanh tiến độ + số trang/số chương ở đáy
- Tự lưu vị trí đọc (chương + số trang) theo thời gian thực

## 9. Cập nhật chương mới

**Không có lịch crawl định kỳ.** Mọi request tới nguồn đều xuất phát từ việc người dùng thực sự dùng web:

1. **Bấm "Kiểm tra chương mới"** — quét mọi truyện đang theo dõi, hiện tiến trình trực tiếp. 50 truyện mất ~10 giây.
2. **Refresh riêng từng truyện** — khi chỉ quan tâm 1 bộ.
3. **Tự kiểm tra khi mở web** (bật mặc định) — chạy nền, không phải chờ; mỗi truyện tối đa 1 lần / 6 giờ. Truyện gần như luôn mới sẵn mà không phải bấm gì. Có thể tắt trong cài đặt.

## 10. Xác thực

Một mật khẩu duy nhất cho cả web; **không đăng nhập thì không xem được bất cứ trang nào**, kể cả endpoint proxy ảnh (chặn ở tầng middleware, mọi request đều qua kiểm tra phiên đăng nhập).

- Mật khẩu ban đầu: `E521satan`, lưu dạng **băm bcrypt** trong file `.env` (loại khỏi git) — không lưu chữ thường ở bất kỳ đâu.
- Đăng nhập bằng phiên (session cookie) ký bảo mật, **ghi nhớ dài hạn** (nhập một lần rồi thôi).
- Có trang **đổi mật khẩu** trong phần cài đặt (khuyến nghị đổi sau khi web chạy, vì mật khẩu ban đầu đã xuất hiện trong hội thoại).
- Chặn công cụ tìm kiếm index (`robots.txt` + header `noindex`).

Lý do: web đặt trên tên miền công khai; bắt buộc đăng nhập để không bị hiểu là trang phát hành lại nội dung có bản quyền, đồng thời tránh người lạ dùng làm hao băng thông VPS.

## 11. Xử lý lỗi

| Tình huống | Cách xử lý |
|---|---|
| API nguồn lỗi/timeout | Thử lại có giãn cách (3 lần); nếu vẫn lỗi thì dùng dữ liệu cache và hiện cảnh báo nhẹ |
| Ảnh một trang lỗi | Hiện nút "tải lại ảnh" tại đúng chỗ đó, không làm sập cả chương |
| Cấu trúc API đổi | Kiểm tra dữ liệu trả về; nếu không đúng dạng thì ghi log rõ ràng và hiện thông báo trên web |
| Truyện bị xoá ở nguồn | Đánh dấu "không còn ở nguồn", vẫn giữ trong kệ và giữ vị trí đọc |
| Cache đầy | Tự xoá ảnh lâu không dùng |

Trang **"Tình trạng hệ thống"** trong web hiện: lần kiểm tra cuối, truyện nào lỗi, dung lượng cache — để thấy vấn đề ngay mà không phải xem log.

## 12. Kiểm thử

- **Tầng nguồn (`ComicSource`):** test với dữ liệu API đã lưu sẵn (fixture) → không phụ thuộc mạng, chạy nhanh, và phát hiện được khi API đổi cấu trúc
- **Ghép URL ảnh:** test riêng vì đây là chỗ dễ sai nhất
- **Proxy ảnh:** test danh sách trắng domain (chặn được domain lạ), test cache hit/miss
- **Vị trí đọc:** test lưu và đọc lại đúng
- **Kiểm tra chương mới:** test phát hiện đúng khi nguồn có chương mới
- **Kiểm thử thật:** một lần chạy đối chiếu với API thật (không chạy trong CI) để xác nhận fixture còn khớp thực tế

## 13. Hạ tầng & triển khai

**VPS:** Oracle Cloud Always Free, region Singapore hoặc Japan (gần Việt Nam). Shape ARM Ampere A1 (tối đa 4 CPU / 24GB RAM / 200GB đĩa trong hạn mức free).

**Triển khai:** Docker Compose. **Một script dựng lại toàn bộ server bằng 1 lệnh** — cài Docker, lấy code, cấu hình HTTPS, khởi động. Chạy lại được nhiều lần không sợ hỏng (idempotent).

**HTTPS:** Caddy làm reverse proxy, tự xin và tự gia hạn chứng chỉ Let's Encrypt cho tên miền của người dùng.

**Backup:** file SQLite được backup hàng đêm (nén, giữ 7 bản gần nhất). Vì không lưu ảnh, backup rất nhỏ.

**Chống thu hồi máy:** tài khoản Always Free có thể bị Oracle thu hồi máy nếu bỏ không quá 7 ngày. Hai lớp bảo vệ:
1. Một việc nhẹ chạy đêm (backup + dọn cache + kiểm tra sức khoẻ) để máy không bị coi là bỏ không
2. Script dựng lại 1 lệnh ở trên — xui bị thu hồi thì ~15 phút là web sống lại, **không mất truyện theo dõi và vị trí đọc** (đều nằm trong file backup)

## 14. Giai đoạn 2 — Truyện chữ (thiết kế sơ bộ)

Truyện chữ không có API nên phải crawl. Thiết kế đã thống nhất, triển khai sau khi giai đoạn 1 xong:

- **Crawler theo cấu hình**, không code riêng cho từng trang: mỗi nguồn là một file YAML khai báo selector (tên truyện, tác giả, mục lục, nội dung, phần tử cần bỏ). Trang đổi layout thì chỉ sửa selector.
- **Bộ trích xuất dự phòng:** nếu selector chết, tự tìm khối văn bản dài nhất để vẫn đọc tạm được.
- **Hai tầng lấy dữ liệu:** HTTP thường trước; chỉ dùng trình duyệt ảo (Playwright) khi trang chặn bot hoặc nạp nội dung bằng JavaScript.
- **Crawl tử tế:** nghỉ 1–2 giây giữa các request, tối đa 2 luồng/trang, tự giãn khi gặp 429/403. **Có lưu điểm dừng** — mất mạng hay restart vẫn tiếp tục được, không tải lại từ đầu.
- **Dọn nội dung:** bỏ quảng cáo, script, banner, dòng chèn quảng bá trang nguồn; chuẩn hoá đoạn văn và khoảng trắng.
- **Lưu trữ:** vì là văn bản (nhẹ) và crawl lại rất tốn thời gian, truyện chữ **được lưu lâu dài** — đây là lúc dùng tới Google Drive 2TB của người dùng, qua Drive API.
- **Giao diện đọc:** tuỳ chỉnh cỡ chữ, khoảng cách dòng, font, lề; 3 chế độ nền; cuộn liên tục nối chương; nạp trước chương sau.

## 15. Rủi ro

| Rủi ro | Mức | Ứng phó |
|---|---|---|
| OTruyen API ngừng hoạt động | Cao | Tầng `ComicSource` tách riêng → đổi nguồn chỉ sửa một module. Giai đoạn 2 (crawl) là phương án thay thế đã có sẵn kỹ thuật. |
| CDN chặn hotlink | Trung bình | Proxy ảnh đã gắn `Referer` — đã tính trong thiết kế |
| Oracle thu hồi VPS free | Trung bình | Việc nhẹ chạy đêm + script dựng lại 1 lệnh + backup |
| Không có sẵn shape ARM free | Trung bình | Thử region khác (Singapore/Japan); hoặc dùng shape AMD micro free |
| Vấn đề bản quyền | Thấp (dùng cá nhân) | Bắt buộc đăng nhập, chặn index, không phát hành công khai, không lưu ảnh |

## 16. Quyết định thiết kế then chốt

| Quyết định | Lý do |
|---|---|
| Dùng API thay vì crawl cho truyện tranh | Bỏ được toàn bộ parser, Playwright, và nỗi lo trang đổi layout |
| Không lưu ảnh truyện tranh | API đã có sẵn ảnh; lưu thêm là việc vô ích. Đổi lại: không đọc offline được — thêm sau nếu cần, chỉ là một lớp cache |
| Không có lịch crawl định kỳ | Chỉ gọi nguồn khi người dùng thực sự dùng web → nhẹ, tử tế với nguồn, ít bị chặn |
| Tài khoản Oracle Always Free thuần, không nâng PAYG | PAYG dù thực tế 0đ nhưng không có cơ chế chặn cứng chi phí; Always Free **không thể** bị trừ tiền |
| Một tiến trình Node.js + SQLite | Chỉ 1–3 người dùng; đơn giản, dễ backup, dễ di chuyển |
| Bắt buộc đăng nhập | Giảm rủi ro pháp lý và tránh hao băng thông |
| Truyện tranh trước, truyện chữ sau | Truyện tranh có API nên xong nhanh, có cái dùng ngay |
