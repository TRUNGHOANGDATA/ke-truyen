/**
 * Quản lý nguồn truyện đang dùng: đổi nguồn (TruyenQQ/OTruyen) và đổi domain
 * TruyenQQ ngay lúc chạy, KHÔNG cần khởi động lại.
 *
 * Trả về một `source` (facade) ủy quyền về nguồn hiện hành, nên các nơi khác
 * (routes, archive, api) giữ nguyên tham chiếu này kể cả khi người dùng đổi nguồn.
 */
import { createNetTruyenSource } from '../source/nettruyen.js';
import { createTruyenQQSource } from '../source/truyenqq.js';
import { createDomainResolver } from '../source/domain-resolver.js';
import { withCache } from '../source/cached.js';
import { withSupplement } from '../source/merged.js';
import { config as defaultConfig } from '../config.js';

export function createSourceManager({
  db,
  settings,
  config = defaultConfig,
  wrap = withCache,
  probeFetch,               // fetch riêng cho việc dò domain (tiện test)
  makeTruyenQQ = createTruyenQQSource,
  makeSupplement = createNetTruyenSource,
  makeResolver = createDomainResolver,
  combine = withSupplement,
} = {}) {
  const resolver = makeResolver({
    settings, candidates: config.TRUYENQQ_MIRRORS,
    ...(probeFetch ? { fetchFn: probeFetch } : {}),
  });

  let raw, active;

  // Kho bổ sung nay crawl NetTruyen (OTruyen API đã chết phần đọc chương).
  // Giữ tên settings 'otruyen' cho tương thích lịch sử.
  // Bọc cache: NetTruyen sau Cloudflare + CDN chậm, cache detail 60' để mở lại
  // trang truyện không phải tải + parse cả trang lớn mỗi lần (chương ít đổi).
  const DAY = 24 * 60 * 60 * 1000;
  const newSupplement = () => wrap(db, makeSupplement({ base: config.NETTRUYEN_BASE }),
    { keyPrefix: 'sup:', detailTtlMs: 60 * 60 * 1000, chapterTtlMs: 7 * DAY });

  function buildRaw(name) {
    if (name === 'otruyen') return newSupplement();
    const qq = makeTruyenQQ({ base: resolver.current(), reprobe: () => resolver.reprobe() });
    // TruyenQQ làm nguồn chính, kho NetTruyen bổ sung những bộ TruyenQQ không có.
    // Tắt được bằng settings: supplement=0.
    if (settings.get('supplement', '1') === '0') return qq;
    return combine(qq, newSupplement());
  }

  function build(name) {
    raw = buildRaw(name);
    active = wrap(db, raw, { searchTtlMs: 10 * 60 * 1000 });
  }

  build(settings.get('source', 'truyenqq'));

  const clearCache = () => { try { db.exec('DELETE FROM api_cache'); } catch { /* bảng có thể trống */ } };

  // Facade: mọi lời gọi đi thẳng tới nguồn hiện hành (đã bọc cache).
  const source = new Proxy({}, {
    get(_, prop) {
      const v = active[prop];
      return typeof v === 'function' ? v.bind(active) : v;
    },
  });

  return {
    source,
    resolver,
    current: () => settings.get('source', 'truyenqq'),

    /** Đổi nguồn (truyenqq|otruyen); xóa cache để không lẫn dữ liệu 2 nguồn. */
    setSource(name) {
      if (name !== 'truyenqq' && name !== 'otruyen') throw new Error('Nguồn không hợp lệ: ' + name);
      settings.set('source', name);
      build(name);
      clearCache();
      return name;
    },

    /** Đang bật bổ sung truyện từ kho OTruyen? */
    supplementOn: () => settings.get("supplement", "1") !== "0",

    /**
     * Bật/tắt bổ sung. Dựng lại nguồn + xóa cache vì kết quả đã cache là bản
     * ĐÃ gộp, không tắt cache thì bấm tắt vẫn thấy truyện bổ sung.
     * Chỉ có tác dụng khi nguồn chính là truyenqq.
     */
    setSupplement(on) {
      settings.set("supplement", on ? "1" : "0");
      build(settings.get("source", "truyenqq"));
      clearCache();
      return on;
    },

    /** Đổi domain TruyenQQ thủ công (đã kiểm tra sống ở tầng route). */
    applyDomain(base) {
      resolver.setCurrent(base);
      if (raw && typeof raw.setBase === 'function') raw.setBase(resolver.current());
      clearCache();
      return resolver.current();
    },

    /** Dò lại ngay: tìm domain sống trong danh sách, áp dụng, xóa cache. Ném lỗi nếu tất cả chết. */
    async reprobe() {
      const found = await resolver.reprobe();
      if (raw && typeof raw.setBase === 'function') raw.setBase(found);
      clearCache();
      return found;
    },
  };
}
