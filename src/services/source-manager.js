/**
 * Quản lý nguồn truyện đang dùng: đổi nguồn (TruyenQQ/OTruyen) và đổi domain
 * TruyenQQ ngay lúc chạy, KHÔNG cần khởi động lại.
 *
 * Trả về một `source` (facade) ủy quyền về nguồn hiện hành, nên các nơi khác
 * (routes, archive, api) giữ nguyên tham chiếu này kể cả khi người dùng đổi nguồn.
 */
import { createSource } from '../source/otruyen.js';
import { createTruyenQQSource } from '../source/truyenqq.js';
import { createDomainResolver } from '../source/domain-resolver.js';
import { withCache } from '../source/cached.js';
import { config as defaultConfig } from '../config.js';

export function createSourceManager({
  db,
  settings,
  config = defaultConfig,
  wrap = withCache,
  probeFetch,               // fetch riêng cho việc dò domain (tiện test)
  makeTruyenQQ = createTruyenQQSource,
  makeOtruyen = createSource,
  makeResolver = createDomainResolver,
} = {}) {
  const resolver = makeResolver({
    settings, candidates: config.TRUYENQQ_MIRRORS,
    ...(probeFetch ? { fetchFn: probeFetch } : {}),
  });

  let raw, active;

  function buildRaw(name) {
    if (name === 'otruyen') {
      return makeOtruyen({ base: config.OTRUYEN_BASE, cdnBase: config.CDN_IMAGE_BASE });
    }
    return makeTruyenQQ({ base: resolver.current(), reprobe: () => resolver.reprobe() });
  }

  function build(name) {
    raw = buildRaw(name);
    active = wrap(db, raw);
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
