import 'node:process';

const required = ['SESSION_SECRET'];
for (const k of required) {
  if (!process.env[k]) console.warn(`[config] missing env ${k} — using insecure default`);
}

/** "id|Nhãn|https://a.com|pre~[|apiBase]" cách nhau bằng dấu phẩy -> mảng site. */
function parseSites(raw) {
  if (!raw) return null;
  const out = raw.split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const [id, label, base, prefix, apiBase] = entry.split('|').map(s => (s || '').trim());
    if (!id || !base || !prefix) return null;
    return { id, label: label || id, base: base.replace(/\/+$/, ''), prefix, ...(apiBase ? { apiBase } : {}) };
  }).filter(Boolean);
  return out.length ? out : null;
}

export const config = {
  PORT: Number(process.env.PORT || 3000),
  DB_PATH: process.env.DB_PATH || './data/app.db',
  CACHE_DIR: process.env.CACHE_DIR || './cache/images',
  SESSION_SECRET: process.env.SESSION_SECRET || 'insecure-dev-secret',
  PASSWORD_HASH: process.env.PASSWORD_HASH || '',
  OTRUYEN_BASE: process.env.OTRUYEN_BASE || 'https://otruyenapi.com/v1/api',
  CDN_IMAGE_BASE: process.env.CDN_IMAGE_BASE || 'https://img.otruyenapi.com',
  // Nguồn truyện: 'truyenqq' (crawl, cập nhật từng phút) hoặc 'otruyen' (API, đã ngừng cập nhật)
  SOURCE: process.env.SOURCE || 'truyenqq',
  TRUYENQQ_BASE: process.env.TRUYENQQ_BASE || 'https://truyenqqko.com',
  // Các domain TruyenQQ hay xoay vòng; domain sống sẽ được tự dò và ghi nhớ.
  // Thêm domain mới qua .env: TRUYENQQ_MIRRORS=a.com,b.com (hoặc nhập trong trang Cài đặt).
  TRUYENQQ_MIRRORS: (process.env.TRUYENQQ_MIRRORS ||
    'https://truyenqqko.com,https://truyenqqto.com,https://truyenqqgo.com,https://truyenqqviet.com,https://truyenqqvn.com,https://truyenqq.com,https://truyenqqmoi.com'
  ).split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean),
  // Nguồn bổ sung truyện tranh: NetTruyen (thay OTruyen API đã chết phần đọc chương)
  NETTRUYEN_BASE: process.env.NETTRUYEN_BASE || "https://nettruyen.id",
  /**
   * Các site DÙNG CHUNG bộ khung NetTruyen (cùng selector -> cùng adapter), mỗi
   * site là một KHO RIÊNG (slug khác nhau, không phải bản sao của nhau):
   *   - Duyệt/tìm: thử lần lượt, site nào sống thì dùng (tự chuyển dự phòng).
   *   - Đọc: mỗi site một tiền tố slug riêng nên chương đã lưu không bị trỏ nhầm.
   * Tiền tố 'ot~' của site đầu giữ nguyên vì thư viện cũ đã lưu theo nó.
   * Ghi đè bằng .env: NETTRUYEN_SITES=id|Nhãn|https://a.com|pre~,id2|...
   */
  NETTRUYEN_SITES: parseSites(process.env.NETTRUYEN_SITES) || [
    // KHÔNG dùng nettruyen.id (prefix ot~): CDN images.truyenonline.cc chặn tải từ
    // máy chủ (đo thật: dội 8 ảnh rớt 7, giãn nhịp 2.5s vẫn 0/5). Hai kho dưới CDN khoẻ.
    { id: 'nettruyenar', label: 'NetTruyen', base: 'https://nettruyenar.com', prefix: 'nar~' },
    { id: 'nettruyenx', label: 'NetTruyen 2', base: 'https://nettruyenx.net', prefix: 'nx~' },
  ],
  // Ứng viên để trang Cài đặt bấm "dò từ máy chủ" (máy ở nhà hay bị chặn, máy chủ thì không).
  PROBE_CANDIDATES: (process.env.PROBE_CANDIDATES ||
    'https://nettruyen.id,https://nettruyenar.com,https://nettruyenx.net,https://nettruyen.co.com,https://cuutruyen.net,https://blogtruyenmoi.com,https://manhuavn.top,https://lxmanga.net'
  ).split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean),
  // Nguồn truyện chữ (Phase 2): truyenfull, crawl HTML
  TRUYENFULL_BASE: process.env.TRUYENFULL_BASE || "https://truyenfull.live",
  // Google Drive — lưu ảnh chương để đọc lâu dài (xem README phần "Lưu offline")
  DRIVE_CLIENT_ID: process.env.DRIVE_CLIENT_ID || '',
  DRIVE_CLIENT_SECRET: process.env.DRIVE_CLIENT_SECRET || '',
  DRIVE_REFRESH_TOKEN: process.env.DRIVE_REFRESH_TOKEN || '',
  DRIVE_FOLDER_ID: process.env.DRIVE_FOLDER_ID || 'root',
};

/** Host ảnh được phép đi qua proxy /img (chặn dùng làm proxy mở) */
export const IMAGE_HOSTS = [
  // OTruyen / NetTruyen (kho bổ sung: bìa + ảnh chương)
  'img.otruyenapi.com', 'otruyencdn.com', 'sv1.otruyencdn.com',
  'nettruyen-api.clubc.org', 'images.truyenonline.cc', 'truyenonline.cc', 'nettruyen.id',
  'cloud-zzz.com', 'kptackpte.com', 'nettruyenar.com', 'nettruyenx.net',   // CDN nar~/nx~
  // TruyenQQ (bìa + ảnh chương)
  'truyenvua.com', 'hinhhinh.com', 'tintruyen.net', 'truyenqqko.com', 'hinhtruyen.com',
  // Truyện chữ (chỉ ảnh bìa; nhiều host: CDN riêng, 8cache, ảnh Google Drive)
  'static.truyenfull.live', 'truyenfull.live', 'truyenfull.vn',
  'truyenngan.8cache.com', '8cache.com', 'lh3.googleusercontent.com',
];

/**
 * Referer để lấy ảnh. CDN của TruyenQQ chống hotlink theo trang web của họ,
 * nên phải gửi Referer là truyenqqko.com — dùng chính host ảnh sẽ bị chặn.
 */
export function refererFor(url) {
  let u;
  try { u = new URL(url); } catch { return undefined; }
  if (/(?:^|\.)(truyenvua\.com|hinhhinh\.com|tintruyen\.net|truyenqqko\.com|hinhtruyen\.com)$/.test(u.hostname)) {
    return config.TRUYENQQ_BASE + '/';
  }
  return u.origin + '/';
}
