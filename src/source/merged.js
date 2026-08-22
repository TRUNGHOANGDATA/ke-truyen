/**
 * Gộp nguồn chính (TruyenQQ) với nguồn bổ sung (OTruyen): chỉ chèn thêm những
 * bộ nguồn chính KHÔNG có, so theo tên đã chuẩn hoá (xem title-key.js).
 *
 * Slug của nguồn bổ sung được gắn tiền tố 'ot~' để:
 *   - detail() biết gọi đúng adapter,
 *   - thư viện không lẫn slug giữa hai nguồn (slug nguồn chính giữ nguyên nên
 *     dữ liệu cũ không phải sửa gì).
 * chapter() nhận URL chứ không nhận slug, nên định tuyến theo host của URL.
 *
 * Nguyên tắc: nguồn bổ sung lỗi thì coi như không có — không bao giờ được làm
 * chết kết quả của nguồn chính.
 */
import { titleKey } from './title-key.js';

// chapter() nhận URL trang đọc; định tuyến về nguồn bổ sung theo host.
// NetTruyen (nettruyen.id) là kho bổ sung hiện tại; giữ host OTruyen cũ cho dữ liệu cũ.
const SUP_HOSTS = /(?:^|\.)(nettruyen\.id|otruyencdn\.com|otruyenapi\.com)$/;

export function withSupplement(primary, secondary, {
  prefix = 'ot~',
  hostRe = SUP_HOSTS,
} = {}) {
  const tag = (s) => prefix + s;
  const isTagged = (s) => typeof s === 'string' && s.startsWith(prefix);
  const untag = (s) => (isTagged(s) ? s.slice(prefix.length) : s);

  /** Gọi nguồn bổ sung, lỗi thì trả null (bỏ qua phần bổ sung). */
  // Nguồn bổ sung (NetTruyen qua Cloudflare) có thể chậm; quá hạn thì bỏ qua để
  // không kéo chậm nguồn chính (trang duyệt/dải thể loại/tìm vẫn hiện nhanh).
  const SUP_TIMEOUT = 6000;
  const trySup = async (fn) => {
    try {
      return await Promise.race([
        fn(),
        new Promise(resolve => setTimeout(() => resolve(null), SUP_TIMEOUT)),
      ]);
    } catch { return null; }
  };

  /** Chèn item của nguồn bổ sung vào sau, bỏ bộ đã có tên trùng. */
  function mergeInto(base, supRes) {
    const items = base?.items || [];
    if (!supRes?.items?.length) return base;
    const seen = new Set(items.map(i => titleKey(i.name)).filter(Boolean));
    const extra = [];
    for (const it of supRes.items) {
      const k = titleKey(it.name);
      if (!k || seen.has(k)) continue;
      seen.add(k);                       // chống trùng trong chính nguồn bổ sung
      extra.push({ ...it, slug: tag(it.slug), fromSupplement: true });
    }
    return extra.length ? { ...base, items: [...items, ...extra] } : base;
  }

  // Thể loại hai nguồn có slug khác nhau -> dịch qua TÊN. Chỉ dựng bảng 1 lần.
  let catMap = null;
  async function supCategorySlug(primarySlug) {
    if (!catMap) {
      catMap = (async () => {
        const [p, s] = await Promise.all([
          Promise.resolve().then(() => primary.categories()).catch(() => []),
          Promise.resolve().then(() => secondary.categories()).catch(() => []),
        ]);
        const byName = new Map((s || []).map(c => [titleKey(c.name), c.slug]));
        const m = new Map();
        for (const c of p || []) {
          const hit = byName.get(titleKey(c.name));
          if (hit) m.set(c.slug, hit);
        }
        return m;
      })();
    }
    const m = await catMap.catch(() => new Map());
    return m.get(primarySlug) || null;
  }

  // Giữ các thứ riêng của nguồn chính (vd setBase/getBase để đổi domain lúc chạy).
  // Phải bind về primary: chỉ spread thì hàm viết theo kiểu `this` sẽ chạy sai chỗ.
  const passthrough = {};
  for (const [k, v] of Object.entries(primary)) {
    passthrough[k] = typeof v === "function" ? v.bind(primary) : v;
  }

  return {
    ...passthrough,

    // Trang chủ là dải "hot" có chọn lọc của nguồn chính -> không pha thêm cho
    // khỏi loãng. Truyện bổ sung vẫn hiện ở các dải thể loại (byCategory).
    home: () => primary.home(),
    categories: () => primary.categories(),

    async list(type = 'truyen-moi', page = 1) {
      const base = await primary.list(type, page);
      return mergeInto(base, await trySup(() => secondary.list(type, page)));
    },

    async search(keyword) {
      const base = await primary.search(keyword);
      return mergeInto(base, await trySup(() => secondary.search(keyword)));
    },

    async byCategory(slug, page = 1) {
      const base = await primary.byCategory(slug, page);
      const supSlug = await supCategorySlug(slug);
      if (!supSlug) return base;
      return mergeInto(base, await trySup(() => secondary.byCategory(supSlug, page)));
    },

    async detail(slug) {
      if (!isTagged(slug)) return primary.detail(slug);
      const d = await secondary.detail(untag(slug));
      // Gắn lại tiền tố: thư viện lưu detail.slug, mất tiền tố là mất đường về.
      return { ...d, slug: tag(d.slug), fromSupplement: true };
    },

    async chapter(apiUrl) {
      let host = '';
      try { host = new URL(apiUrl).hostname; } catch { /* không phải URL tuyệt đối */ }
      return host && hostRe.test(host) ? secondary.chapter(apiUrl) : primary.chapter(apiUrl);
    },
  };
}
