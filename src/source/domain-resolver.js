/**
 * Tự bắt tên miền TruyenQQ khi nó "nhảy" domain (phương án C).
 *
 * Giữ danh sách domain ứng viên; khi domain đang dùng chết thì reprobe() thử lần
 * lượt cho tới khi gặp trang TruyenQQ hợp lệ, rồi GHI NHỚ vào settings làm domain
 * chính. Lần sau vào thẳng, không dò lại.
 */

/** Nhận diện một trang có đúng là TruyenQQ không (tránh dính trang parking/redirect). */
export function looksLikeTruyenQQ(html) {
  if (!html || html.length < 500) return false;
  const hasComicLinks = /\/truyen-tranh\//i.test(html);
  const hasChrome = /<html[\s>]/i.test(html) && /truyenqq|thể loại|truyện tranh/i.test(html);
  return hasComicLinks && hasChrome;
}

const stripSlash = (u) => String(u || '').replace(/\/+$/, '');

export function createDomainResolver({
  settings,
  candidates = [],
  fetchFn = fetch,
  probePath = '/doc-truyen',
  validate = looksLikeTruyenQQ,
  timeoutMs = 8000,
} = {}) {
  let current = stripSlash(settings.get('truyenqq_base') || candidates[0] || '');

  const list = () => {
    const seen = new Set();
    return [current, ...candidates].map(stripSlash).filter(u => u && !seen.has(u) && seen.add(u));
  };

  async function probe(baseUrl) {
    let signal;
    try { signal = AbortSignal.timeout(timeoutMs); } catch { signal = undefined; }
    const res = await fetchFn(baseUrl + probePath, {
      signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        'Accept-Language': 'vi,en;q=0.8',
      },
    });
    if (!res.ok) return false;
    return validate(await res.text());
  }

  return {
    current: () => current,

    /** Đặt domain thủ công (từ trang Cài đặt) — không kiểm tra ở đây. */
    setCurrent(base) {
      current = stripSlash(base);
      settings.set('truyenqq_base', current);
      return current;
    },

    /** Kiểm tra một domain có sống + đúng TruyenQQ không (dùng khi lưu tay). */
    async check(base) {
      try { return await probe(stripSlash(base)); } catch { return false; }
    },

    /** Dò lại: trả domain sống đầu tiên, ghi nhớ; ném lỗi nếu tất cả chết. */
    async reprobe() {
      for (const cand of list()) {
        try {
          if (await probe(cand)) {
            current = cand;
            settings.set('truyenqq_base', cand);
            return cand;
          }
        } catch { /* thử cái tiếp theo */ }
      }
      throw new Error('Tất cả domain TruyenQQ đều không truy cập được');
    },
  };
}
