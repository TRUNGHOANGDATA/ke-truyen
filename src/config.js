import 'node:process';

const required = ['SESSION_SECRET'];
for (const k of required) {
  if (!process.env[k]) console.warn(`[config] missing env ${k} — using insecure default`);
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
};

/** Host ảnh được phép đi qua proxy /img (chặn dùng làm proxy mở) */
export const IMAGE_HOSTS = [
  // OTruyen
  'img.otruyenapi.com', 'otruyencdn.com',
  // TruyenQQ (bìa + ảnh chương)
  'truyenvua.com', 'hinhhinh.com', 'tintruyen.net', 'truyenqqko.com',
];

/**
 * Referer để lấy ảnh. CDN của TruyenQQ chống hotlink theo trang web của họ,
 * nên phải gửi Referer là truyenqqko.com — dùng chính host ảnh sẽ bị chặn.
 */
export function refererFor(url) {
  let u;
  try { u = new URL(url); } catch { return undefined; }
  if (/(?:^|\.)(truyenvua\.com|hinhhinh\.com|tintruyen\.net|truyenqqko\.com)$/.test(u.hostname)) {
    return config.TRUYENQQ_BASE + '/';
  }
  return u.origin + '/';
}
