# CLAUDE.md — Kệ Truyện

Web đọc **truyện tranh** tiếng Việt, cá nhân (1-2 người), không quảng cáo. Tự crawl từ
nguồn (TruyenQQ), có tùy chọn lưu ảnh lên Google Drive để đọc lâu dài. Toàn bộ sau một
mật khẩu đăng nhập. Giao diện clone TruyenQQ nhưng bỏ hết quảng cáo/branding.

- **Triển khai:** Docker + Caddy trên bất kỳ VPS Ubuntu nào. Xem [HUONG-DAN-DEPLOY.md](HUONG-DAN-DEPLOY.md).
- **Ngôn ngữ:** UI + comment code bằng tiếng Việt.
- **Phase 2 (đã có MVP):** truyện chữ (text novel) — nguồn truyenfull, xem mục Truyện chữ bên dưới.

## Lệnh hay dùng
```bash
npm start        # chạy web (node --env-file=.env src/server.js) -> http://localhost:3000
npm run dev      # như trên + --watch
npm test         # node --test (toàn bộ test, ~123 test)
npm run drive:auth    # lấy DRIVE_REFRESH_TOKEN (luồng OAuth loopback)
npm run drive:check   # tự kiểm tra kết nối Google Drive
node --test tests/xxx.test.js   # chạy 1 file test
```
Không có bước build. Node 20+ (dùng `node --env-file`). Windows: shell là PowerShell,
nhưng có sẵn Bash tool cho script POSIX.

## Stack
Express + EJS (render phía server) + JS thuần phía client (không framework, không bundler).
`better-sqlite3` (1 file DB), `bcryptjs`, `cookie-session`, `cheerio` (parse HTML crawl).
Google Drive gọi REST bằng `fetch` (không dùng lib googleapis).

## Kiến trúc

**Điểm gốc:** [src/app.js](src/app.js) `buildApp(deps)` — nối tất cả, nhận `deps` để test
inject (db, source, fetchFn…). [src/server.js](src/server.js) chỉ mở DB thật rồi listen.

**Nguồn truyện (adapter pattern)** — mọi nguồn cùng interface: `home/list/search/
categories/byCategory/detail/chapter`.
- [src/source/truyenqq.js](src/source/truyenqq.js) — crawl TruyenQQ bằng cheerio (nguồn chính).
- [src/source/nettruyen.js](src/source/nettruyen.js) `createNetTruyenSource` — **adapter cho KHUNG NetTruyen**, dùng lại được cho nhiều site cùng khung (xem `config.NETTRUYEN_SITES`). Thay [otruyen.js](src/source/otruyen.js) (client API OTruyen — API đọc chương đã chết, giữ lại làm tham chiếu). `chapter()` trả `{images}`. Hai điểm phải nhớ:
  - **Tìm kiếm:** site nào khai `apiBase` thì gọi API JSON (`?keyword=`, KHÔNG phải `?q=`); site không có thì crawl `/tim-truyen?keyword=`.
  - **Mục lục bị cắt:** vài site chỉ nhả ~20 chương mới nhất trong HTML (nút "Xem thêm" bị ẩn, `href="#"` — phải lọc bằng `isChapterHref`). Mục lục ĐẦY ĐỦ lấy qua endpoint JSON `/Comic/Services/ComicService.asmx/ProcessChapterList?comicId=<id>`; `comicId` = `data-id` KHÔNG nằm trên link chương.
- [src/source/cached.js](src/source/cached.js) `withCache` — cache home/list/byCategory/categories trong bảng `api_cache` (TTL 30', stale-fallback khi nguồn lỗi).
- [src/source/clean.js](src/source/clean.js) — `cleanSynopsis`/`scrubBrands` bỏ HTML + đoạn SEO + tên nguồn.
- [src/services/source-manager.js](src/services/source-manager.js) `createSourceManager` — chọn/đổi nguồn + domain **lúc chạy** (không cần restart); trả về facade (Proxy) ủy quyền. Đổi nguồn thì xóa `api_cache`. Dựng **một adapter cho mỗi site** trong `config.NETTRUYEN_SITES` (cache tách riêng theo `keyPrefix: sup:<id>:`). `comicSources()` liệt kê mọi nguồn tranh `{id,label,prefix,src}` — dùng cho nút "⇄ Nguồn" ở trang đọc và cho danh sách referer của proxy ảnh.
- [src/source/merged.js](src/source/merged.js) `withSupplement(primary, secondaries)` — **gộp nguồn**: TruyenQQ chính, các kho NetTruyen bổ sung những bộ TruyenQQ KHÔNG có (so tên qua [title-key.js](src/source/title-key.js), bỏ dấu + hạ chữ). Nhận **một mảng** kho `{prefix, src, hostRe}` (vẫn nhận một nguồn đơn kiểu cũ).
  - **Mỗi kho là kho RIÊNG, không phải bản sao của nhau** — slug khác nhau hoàn toàn. Nên mỗi kho có **tiền tố slug riêng** (`ot~`, `nar~`, `nx~`…): `detail()` định tuyến theo tiền tố, `chapter()` theo **host** của URL. Kho `ot~` còn nhận thêm host đời cũ (`otruyencdn.com`/`otruyenapi.com`) vì thư viện cũ đã lưu theo đó. Slug TruyenQQ giữ nguyên (không tiền tố) nên dữ liệu cũ không phải migrate.
  - **Tự chuyển dự phòng CHỈ ở khâu duyệt/tìm** (`list`/`search`/`byCategory`): thử lần lượt các kho, kho nào trả về có item thì dùng, gắn đúng tiền tố của kho đó. Có hạn tổng (`SUP_BUDGET`) để không kéo dài. KHÔNG rotate ở `detail`/`chapter` — làm thế là trỏ slug sang kho khác, hỏng dữ liệu đã lưu.
  - Kho lỗi thì bỏ qua, không làm chết nguồn chính. Trang chủ + danh sách thể loại chỉ lấy từ nguồn chính; thể loại dịch slug giữa các nguồn qua tên. Tắt bằng `settings` `supplement=0`.
- [src/source/truyenfull.js](src/source/truyenfull.js) `createTruyenfullSource` — **nguồn truyện CHỮ (Phase 2)**, crawl HTML. Cùng bộ phương thức nhưng item mang `kind:'novel'` và `chapter()` trả `{paragraphs,title}` (đoạn văn) thay vì ảnh. Mục lục gộp mọi trang `/{slug}/trang-N/` (đọc `#total-page`, tải song song theo lô). Là **trục riêng** với truyện tranh: wire thẳng trong [app.js](src/app.js) là `novelSource`, KHÔNG qua source-manager/merge. Slug lưu kèm tiền tố `tf~` (chống trùng slug trong bảng dùng chung + là tín hiệu "đây là truyện chữ"); `app.locals.detailUrl` bóc tiền tố để thẻ truyện link đúng `/chu/...`. Route: `/chu` (duyệt/tìm), `/chu/:slug` (chi tiết), `/doc-chu/:slug/:chapter` (đọc). Reader chữ [reader-novel.ejs](src/views/reader-novel.ejs) + [reader-novel.js](src/public/js/reader-novel.js): nền giấy, căn đều, chỉnh cỡ chữ (nhớ localStorage), lưu vị trí đọc theo **% cuộn** (tái dùng cột `image_page`). Theo dõi qua `/api/novel/follow`; unfollow/progress dùng chung API (slug đã có tiền tố).
- [src/source/domain-resolver.js](src/source/domain-resolver.js) — **tự bắt domain TruyenQQ** khi nó nhảy tên miền: dò danh sách mirror (`config.TRUYENQQ_MIRRORS`), gặp domain sống thì ghi nhớ vào `settings`. `truyenqq.js` gọi `reprobe` khi request lỗi rồi thử lại.

**Cấu hình sửa được trong web:** [src/services/settings.js](src/services/settings.js) bọc bảng
`settings(key,value)`. Key: `source`, `truyenqq_base`, `supplement`, `image_hosts_learned`,
`image_referers_learned`. DB là nguồn chân lý lúc chạy; `.env` chỉ seed lần đầu. Trang
**/settings** ([views/settings.ejs](src/views/settings.ejs)) đổi nguồn / bật-tắt bổ sung /
kiểm-tra-&-lưu domain / "↻ Tự dò lại ngay" / **"Dò nguồn từ máy chủ"**.

**Dò nguồn từ máy chủ:** [src/services/site-prober.js](src/services/site-prober.js)
`createSiteProber` + `POST /settings/probe`. Lý do tồn tại: **máy ở nhà thường bị nhà mạng
chặn các trang truyện** — dò ở đó ra "chết" trong khi máy chủ vào bình thường, nên muốn
biết một nguồn có dùng được không thì phải để chính máy chủ thử. Trả về tốc độ + **"khung"
web nhận diện được** (`THEMES`): trùng khung NetTruyen/TruyenQQ thì adapter sẵn có dùng lại
được ngay, khỏi viết parser mới. Có `safeTarget` chặn localhost/IP nội bộ (SSRF).
Danh sách ứng viên mặc định ở `config.PROBE_CANDIDATES`.

**Ảnh (proxy):** [src/routes/image.js](src/routes/image.js) — URL ảnh gói base64url thành
`/img?i=<packImg(url)>` (không lộ host CDN nguồn). Phục vụ theo thứ tự: cache đĩa →
Drive (nếu đã lưu) → nguồn gốc. Cache LRU đĩa: [src/cache/imageCache.js](src/cache/imageCache.js).
**CDN của các nguồn đều chống hotlink** nên phải giả `Referer`, và host ảnh thì hay đổi —
xử lý bằng hai lớp TỰ HỌC trong [src/services/image-hosts.js](src/services/image-hosts.js):
- *Host:* whitelist tĩnh (`config.IMAGE_HOSTS`) + host tự học mỗi khi web dựng link ảnh
  (`app.locals.img`). Nguồn đổi CDN thì host mới tự được chấp nhận, không phải sửa code.
  Chặn IP nội bộ/localhost để không thành proxy mở (SSRF).
- *Referer:* thử lần lượt referer **đã học cho host đó** → `config.refererFor` → base của
  **mọi nguồn đang đăng ký** (`manager.comicSources()`). Tổ hợp nào lấy được ảnh thì nhớ
  lại theo host, ảnh sau đi thẳng (đo thật: 4852ms → 1323ms).

**Lưu offline (Google Drive):** [src/storage/drive.js](src/storage/drive.js) (OAuth refresh
token, scope `drive.file`) + [src/services/archive.js](src/services/archive.js) (`archiveComic`
chạy nền, resume được, bỏ qua ảnh lỗi sau 3 lần thử). Nút "⬇ Lưu offline" ở **trang chi
tiết từng truyện** (không phải trang danh sách).

**Thư viện/tiến độ:** [src/services/library.js](src/services/library.js) — cột `comics.followed`
tách "trong thư viện" khỏi "đang theo dõi"; `remember()` ghi tiến độ đọc.

**Auth:** [src/routes/auth.js](src/routes/auth.js) — 1 mật khẩu (bcrypt hash trong
`PASSWORD_HASH`), cookie-session. `requireAuth` chặn mọi thứ trừ `/login`, `/healthz`,
`/public`. Trang chưa auth → 302 về /login; API → 401.

**Chọn nguồn ở trang đọc:** thanh đọc bày sẵn dãy nút `Nguồn [1][2][3]` (số đang đọc
sáng lên) — [reader.ejs](src/views/reader.ejs) `#srcPick` + [reader.js](src/public/js/reader.js).
Dữ liệu từ `GET /api/other-sources` (tìm cùng bộ ở các nguồn khác, so tên qua `titleKey`),
gọi **ngay khi mở trang** chứ không đợi bấm. Phép tra này phải gọi `search()` tới TỪNG
nguồn (~2-3 giây) nên kết quả được nhớ 12 tiếng bằng [kv-cache.js](src/services/kv-cache.js)
— khoá gồm danh sách id nguồn nên thêm/bớt nguồn thì bản cũ tự hết giá trị; chỉ nhớ ánh xạ
*bộ → slug ở từng nguồn*, còn số chương ghép vào lúc trả lời (đo thật: 2276ms → 2ms).

**Routes:** [pages.js](src/routes/pages.js) (trang + /settings), [api.js](src/routes/api.js)
(/api/archive, /api/status…), [image.js](src/routes/image.js), [auth.js](src/routes/auth.js).
**DB:** [src/db/migrations.js](src/db/migrations.js) — bảng comics/chapters/reading_progress/
settings/api_cache/archive/archive_jobs.

## Quy ước
- **Tiếng Việt** cho UI và comment. Luôn `scrubBrands` để không lộ đã crawl từ đâu.
- Font **Roboto Condensed**, **chỉ light mode**, phần giới thiệu **căn đều (justify)**.
- Trang chủ: chỉ "đang đọc dở" + gợi ý theo thể loại (12+ thể loại) + banner hot; danh sách theo dõi ở tab riêng /following.
- Thể loại khai báo theo TÊN trong `pages.js` (`HOME_GENRES`), map sang slug của nguồn đang dùng.
- Tách module nhỏ, một việc; test đi kèm (node:test + supertest, inject `fetchFn`/`deps` để test offline theo fixtures trong `tests/fixtures`).

## .env (xem [.env.example](.env.example))
`SESSION_SECRET`, `PASSWORD_HASH` (bcrypt của mật khẩu đăng nhập — tạo bằng
`node scripts/hash-password.js '<pass>'`), `SOURCE`, `TRUYENQQ_BASE`, `TRUYENQQ_MIRRORS`,
`NETTRUYEN_SITES` (`id|Nhãn|https://a.com|tiền_tố~[|apiBase]`, cách nhau bằng dấu phẩy),
`PROBE_CANDIDATES`,
`DRIVE_CLIENT_ID/SECRET/REFRESH_TOKEN`, `DRIVE_FOLDER_ID`, `DOMAIN`. **`.env` không commit** (gitignore).

## Triển khai (Docker + Caddy, chạy được trên mọi VPS Ubuntu)
Chi tiết đầy đủ: [HUONG-DAN-DEPLOY.md](HUONG-DAN-DEPLOY.md). Bản cũ chạy trên Oracle Always
Free (1 OCPU/1GB) — hướng dẫn riêng cho Oracle giữ ở [docs/DEPLOY-oracle-cu.md](docs/DEPLOY-oracle-cu.md).

**Bẫy đã gặp — nhớ kỹ khi deploy:**
1. **Đóng gói tar phải neo exclude ở gốc:** dùng `--exclude=./cache --exclude=./data`, KHÔNG dùng `--exclude=cache` (sẽ lỡ loại luôn `src/cache/` → app crash `ERR_MODULE_NOT_FOUND`).
2. **Container đọc .env bằng `node --env-file`, KHÔNG dùng `env_file:` của Compose** ([docker-compose.yml](docker-compose.yml)) — vì Compose nội suy dấu `$` làm hỏng bcrypt `PASSWORD_HASH` → login 401.
3. Máy 1GB RAM cần **swap** trước khi `docker compose build` (better-sqlite3 biên dịch nặng).
4. Oracle Ubuntu chặn sẵn cổng — phải mở **cả** Security List (Console) **và** iptables trên máy (script [scripts/setup-server.sh](scripts/setup-server.sh) tự mở 80/443).

**Cập nhật lên máy chủ:** đẩy code mới lên (git pull hoặc scp — nhớ neo exclude đúng) rồi
`cd ~/ke-truyen && sudo docker compose up -d --build`. Dữ liệu ở `data/` + `cache/` (bind
mount) không mất; `.env` trên máy chủ giữ nguyên, không ghi đè.

## Git
- Branch chính: `main` (đang làm trên `master`). Commit message tiếng Việt không dấu, kết thúc `Co-Authored-By: Claude ...`.
- Không commit: `.env`, `data/`, `cache/`, `node_modules/`, `ssh-key*`, `*.key`.
