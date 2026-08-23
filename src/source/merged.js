/**
 * Gộp nguồn chính (TruyenQQ) với MỘT HAY NHIỀU kho bổ sung: chỉ chèn thêm những
 * bộ nguồn chính KHÔNG có, so theo tên đã chuẩn hoá (xem title-key.js).
 *
 * Slug của kho bổ sung được gắn tiền tố riêng cho từng kho ('ot~', 'nar~'…) để:
 *   - detail() biết gọi đúng adapter,
 *   - thư viện không lẫn slug giữa các nguồn (slug nguồn chính giữ nguyên nên
 *     dữ liệu cũ không phải sửa gì).
 * chapter() nhận URL chứ không nhận slug, nên định tuyến theo host của URL.
 *
 * Các kho bổ sung là KHO RIÊNG BIỆT (slug khác nhau), không phải bản sao của
 * nhau — nên "tự chuyển dự phòng" chỉ áp dụng cho việc DUYỆT/TÌM (mỗi lần trả
 * slug mới, đổi kho vô hại). Còn detail()/chapter() luôn về đúng kho của slug.
 *
 * Nguyên tắc: kho bổ sung lỗi thì coi như không có — không bao giờ được làm
 * chết kết quả của nguồn chính.
 */
import { titleKey } from './title-key.js';

// Host của các kho bổ sung ĐỜI CŨ (dữ liệu chương đã lưu còn trỏ tới).
const SUP_HOSTS = /(?:^|\.)(nettruyen\.id|otruyencdn\.com|otruyenapi\.com)$/;

/** Kho bổ sung (NetTruyen sau Cloudflare) có thể chậm; quá hạn thì bỏ qua. */
const SUP_TIMEOUT = 6000;
/** Tổng thời gian tối đa cho CẢ chuỗi kho dự phòng của một lời gọi duyệt/tìm. */
const SUP_BUDGET = 8000;

const hostReOf = (src) => {
  try {
    const h = new URL(src.getBase()).hostname.replace(/^www\./, '');
    return new RegExp('(?:^|\\.)' + h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
  } catch { return null; }
};

const combine = (a, b) => new RegExp(`(?:${a.source})|(?:${b.source})`);

/** Chấp nhận cả một nguồn đơn (kiểu cũ) lẫn mảng { prefix, src, hostRe }. */
function normalize(secondaries, defPrefix, defHostRe) {
  const raw = Array.isArray(secondaries) ? secondaries : [secondaries];
  return raw.filter(Boolean).map((s, i) => {
    const entry = s && s.src ? s : { src: s };
    const src = entry.src;
    const pre = entry.prefix || (i === 0 ? defPrefix : `sup${i}~`);
    // Kho mang tiền tố cũ ('ot~') phải nhận cả các host đời trước, vì chương đã
    // lưu trong thư viện còn trỏ tới chúng.
    const own = entry.hostRe || hostReOf(src);
    const hostRe = pre === defPrefix
      ? (own ? combine(own, defHostRe) : defHostRe)
      : (own || defHostRe);
    return { src, prefix: pre, hostRe };
  });
}

export function withSupplement(primary, secondaries, {
  prefix = 'ot~',
  hostRe = SUP_HOSTS,
} = {}) {
  const sups = normalize(secondaries, prefix, hostRe);
  const isTagged = (s) => typeof s === 'string' && sups.some(x => s.startsWith(x.prefix));
  const supFor = (s) => sups.find(x => typeof s === 'string' && s.startsWith(x.prefix)) || null;

  /** Gọi một kho, lỗi/quá hạn thì trả null (bỏ qua kho đó). */
  const trySup = async (fn, ms = SUP_TIMEOUT) => {
    try {
      return await Promise.race([
        fn(),
        new Promise(resolve => setTimeout(() => resolve(null), ms)),
      ]);
    } catch { return null; }
  };

  /**
   * Thử lần lượt các kho tới khi có kho trả về kết quả CÓ ITEM (tự chuyển dự
   * phòng khi kho ưu tiên chết). Chia sẻ một hạn tổng để không kéo dài vô hạn.
   */
  async function firstAlive(call) {
    const deadline = Date.now() + SUP_BUDGET;
    let fallback = null;
    for (const sup of sups) {
      const left = deadline - Date.now();
      if (left < 500 && fallback !== null) break;
      const res = await trySup(() => call(sup), Math.max(1500, Math.min(SUP_TIMEOUT, left)));
      if (res?.items?.length) return { sup, res };
      if (res && !fallback) fallback = { sup, res };
    }
    return fallback;
  }

  /** Chèn item của kho bổ sung vào sau, bỏ bộ đã có tên trùng. */
  function mergeInto(base, hit) {
    const items = base?.items || [];
    if (!hit?.res?.items?.length) return base;
    const seen = new Set(items.map(i => titleKey(i.name)).filter(Boolean));
    const extra = [];
    for (const it of hit.res.items) {
      const k = titleKey(it.name);
      if (!k || seen.has(k)) continue;
      seen.add(k);                       // chống trùng trong chính kho bổ sung
      extra.push({ ...it, slug: hit.sup.prefix + it.slug, fromSupplement: true });
    }
    return extra.length ? { ...base, items: [...items, ...extra] } : base;
  }

  // Thể loại các nguồn có slug khác nhau -> dịch qua TÊN. Dựng bảng 1 lần / kho.
  const catMaps = new Map();
  async function supCategorySlug(sup, primarySlug) {
    if (!catMaps.has(sup)) {
      catMaps.set(sup, (async () => {
        const [p, s] = await Promise.all([
          Promise.resolve().then(() => primary.categories()).catch(() => []),
          Promise.resolve().then(() => sup.src.categories()).catch(() => []),
        ]);
        const byName = new Map((s || []).map(c => [titleKey(c.name), c.slug]));
        const m = new Map();
        for (const c of p || []) {
          const hit = byName.get(titleKey(c.name));
          if (hit) m.set(c.slug, hit);
        }
        return m;
      })());
    }
    const m = await catMaps.get(sup).catch(() => new Map());
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
      return mergeInto(base, await firstAlive(sup => sup.src.list(type, page)));
    },

    async search(keyword) {
      const base = await primary.search(keyword);
      return mergeInto(base, await firstAlive(sup => sup.src.search(keyword)));
    },

    async byCategory(slug, page = 1) {
      const base = await primary.byCategory(slug, page);
      return mergeInto(base, await firstAlive(async (sup) => {
        const supSlug = await supCategorySlug(sup, slug);
        return supSlug ? sup.src.byCategory(supSlug, page) : null;
      }));
    },

    async detail(slug) {
      const sup = supFor(slug);
      if (!sup) return primary.detail(slug);
      const d = await sup.src.detail(slug.slice(sup.prefix.length));
      // Gắn lại tiền tố: thư viện lưu detail.slug, mất tiền tố là mất đường về.
      return { ...d, slug: sup.prefix + d.slug, fromSupplement: true };
    },

    async chapter(apiUrl) {
      let host = '';
      try { host = new URL(apiUrl).hostname; } catch { /* không phải URL tuyệt đối */ }
      if (!host) return primary.chapter(apiUrl);
      const sup = sups.find(s => s.hostRe?.test(host));
      return sup ? sup.src.chapter(apiUrl) : primary.chapter(apiUrl);
    },

    /** Tiền tố slug của mọi kho bổ sung (route/api cần biết để nhận diện). */
    supplementPrefixes: () => sups.map(s => s.prefix),
  };
}
