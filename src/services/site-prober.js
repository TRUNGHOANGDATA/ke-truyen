/**
 * Dò thử một trang nguồn TỪ MÁY CHỦ.
 *
 * Lý do tồn tại: máy ở nhà thường bị nhà mạng chặn các trang truyện (dò từ đó
 * ra "chết" trong khi máy chủ vào bình thường), nên muốn biết một nguồn có dùng
 * được không thì phải để chính máy chủ thử.
 *
 * Trả về cả "khung" (theme) nhận diện được — nếu trùng khung nguồn sẵn có thì
 * adapter cũ dùng lại được ngay, không phải viết parser mới.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** Dấu vân tay khung web -> adapter tái dùng được. */
export const THEMES = [
  { id: 'nettruyen', label: 'Khung NetTruyen', adapter: 'nettruyen.js', re: /class="items"|id="nt_listchapter"|title-detail|page-chapter/i },
  { id: 'truyenqq', label: 'Khung TruyenQQ', adapter: 'truyenqq.js', re: /list_grid|book_avatar|chapter_content|lst_chapter/i },
  { id: 'madara', label: 'WordPress Madara', adapter: null, re: /wp-manga|madara|chapter-readingnav/i },
];

/** Chỉ cho dò tên miền công khai — chặn IP nội bộ/localhost (tránh SSRF). */
export function safeTarget(raw) {
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return null;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/.test(h)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  return u.origin;
}

export function createSiteProber({ fetchFn = fetch, timeoutMs = 10000, now = () => Date.now() } = {}) {
  async function probeOne(raw) {
    const base = safeTarget(raw);
    if (!base) return { input: String(raw), ok: false, error: 'Địa chỉ không hợp lệ' };

    const t0 = now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(base + '/', {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { 'User-Agent': UA, 'Accept-Language': 'vi,en;q=0.8', Accept: 'text/html,*/*' },
      });
      const html = await res.text();
      const ms = now() - t0;
      const theme = THEMES.find(t => t.re.test(html)) || null;
      // Có link truyện = trang thật, không phải trang đỗ tên miền / chuyển hướng.
      const comicLinks = [...new Set(
        [...html.matchAll(/href="[^"]*\/(?:truyen-tranh|truyen|manga)\/([a-z0-9-]{3,})"/gi)].map(m => m[1]),
      )];
      return {
        input: base,
        ok: res.ok && comicLinks.length > 0,
        status: res.status,
        ms,
        sizeKb: Math.round(html.length / 1024),
        finalUrl: res.url && res.url.replace(/\/$/, '') !== base ? res.url : null,
        theme: theme ? theme.id : null,
        themeLabel: theme ? theme.label : null,
        adapter: theme ? theme.adapter : null,
        comicCount: comicLinks.length,
        sample: comicLinks[0] || null,
      };
    } catch (err) {
      const ms = now() - t0;
      const name = err?.name === 'AbortError' ? 'Quá hạn (không phản hồi)' : (err?.cause?.code || err?.message || 'Lỗi');
      return { input: base, ok: false, ms, error: String(name) };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    probeOne,
    /** Dò song song nhiều trang; không bao giờ ném lỗi (mỗi mục tự mang lỗi). */
    async probeAll(list = []) {
      return Promise.all(list.slice(0, 20).map(probeOne));
    },
  };
}
