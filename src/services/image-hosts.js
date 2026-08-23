/**
 * Danh sách host ảnh được phép đi qua proxy /img.
 *
 * = host tĩnh (config.IMAGE_HOSTS) + host TỰ HỌC lúc chạy. Mỗi khi web dựng một
 * link ảnh (app.locals.img) thì host đó được ghi nhận, nên khi nguồn (TruyenQQ...)
 * đổi CDN ảnh, host mới tự được chấp nhận — không cần sửa code.
 *
 * An toàn: chỉ học host mà CHÍNH web tạo link tới (từ dữ liệu nguồn), và loại bỏ
 * IP nội bộ / localhost để tránh bị lợi dụng làm proxy tới mạng nội bộ (SSRF).
 */
const KEY = 'image_hosts_learned';

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return ''; } };

// Host công khai hợp lệ (có tên miền), KHÔNG phải IP/nội bộ.
function safeHost(h) {
  if (!h || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return false;      // phải là tên miền
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;          // 172.16–31.x.x
  return true;
}

export function createImageHosts(settings, staticHosts = []) {
  const staticSet = new Set(staticHosts.map(s => s.toLowerCase()));
  const learned = new Set(
    (settings.get(KEY, '') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  );

  const matches = (host, suffix) => host === suffix || host.endsWith('.' + suffix);

  return {
    allowed(url) {
      const h = hostOf(url);
      if (!h) return false;
      for (const s of staticSet) if (matches(h, s)) return true;
      return learned.has(h);
    },
    learn(url) {
      const h = hostOf(url);
      if (!h || learned.has(h) || !safeHost(h)) return;
      // đã khớp host tĩnh thì khỏi học
      for (const s of staticSet) if (matches(h, s)) return;
      learned.add(h);
      settings.set(KEY, [...learned].join(','));
    },
    learnedList: () => [...learned],
  };
}
