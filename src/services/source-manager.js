/**
 * Quản lý nguồn truyện đang dùng: đổi NGUỒN CHÍNH và đổi domain TruyenQQ ngay lúc
 * chạy, KHÔNG cần khởi động lại.
 *
 * Nguồn được gom thành một REGISTRY thống nhất:
 *   - 'truyenqq' — nguồn chính có sẵn (domain tự dò). Khi là nguồn chính, các kho
 *     còn lại được GỘP bổ sung (những bộ TruyenQQ không có).
 *   - Các site trong config.COMIC_SITES (+ site người dùng tự thêm, lưu ở settings)
 *     — mỗi site khai KHUNG (framework) để dựng đúng adapter. Có thể (a) bổ sung
 *     cho TruyenQQ, hoặc (b) TỰ CHỌN làm nguồn chính đứng riêng.
 *
 * Trả về một `source` (facade) ủy quyền về nguồn hiện hành, nên nơi khác (routes,
 * archive, api) giữ nguyên tham chiếu này kể cả khi người dùng đổi nguồn.
 */
import { createNetTruyenSource } from '../source/nettruyen.js';
import { createTruyenQQSource } from '../source/truyenqq.js';
import { createTopTruyenSource } from '../source/toptruyen.js';
import { createDomainResolver } from '../source/domain-resolver.js';
import { safeTarget } from './site-prober.js';
import { withCache } from '../source/cached.js';
import { withSupplement } from '../source/merged.js';
import { config as defaultConfig } from '../config.js';

const CUSTOM_KEY = 'comic_sites';   // settings: mảng JSON các nguồn người dùng thêm

export function createSourceManager({
  db,
  settings,
  config = defaultConfig,
  wrap = withCache,
  probeFetch,               // fetch riêng cho việc dò domain (tiện test)
  makeTruyenQQ = createTruyenQQSource,
  makeSupplement = createNetTruyenSource,   // khung NetTruyen (mặc định)
  makeTopTruyen = createTopTruyenSource,    // khung TopTruyen
  makeResolver = createDomainResolver,
  combine = withSupplement,
} = {}) {
  const resolver = makeResolver({
    settings, candidates: config.TRUYENQQ_MIRRORS,
    ...(probeFetch ? { fetchFn: probeFetch } : {}),
  });

  const DAY = 24 * 60 * 60 * 1000;

  /** Dựng adapter theo KHUNG. */
  function makeAdapter(framework, opts) {
    if (framework === 'truyenqq') return makeTruyenQQ(opts);
    if (framework === 'toptruyen') return makeTopTruyen(opts);
    return makeSupplement(opts);            // 'nettruyen' hoặc không rõ -> khung NetTruyen
  }

  /** Nguồn người dùng tự thêm (lưu DB). Hỏng JSON thì coi như rỗng. */
  function customSites() {
    try {
      const arr = JSON.parse(settings.get(CUSTOM_KEY, '') || '[]');
      return Array.isArray(arr) ? arr.filter(s => s && s.id && s.base && s.prefix) : [];
    } catch { return []; }
  }

  /**
   * Danh sách các nguồn PHỤ (không tính TruyenQQ): config + tự thêm, khử trùng theo
   * id (bản tự thêm ghi đè). Site không khai framework -> coi là khung NetTruyen.
   */
  function secondaryDefs() {
    const fromCfg = config.COMIC_SITES?.length ? config.COMIC_SITES
      : (config.NETTRUYEN_SITES?.length ? config.NETTRUYEN_SITES.map(s => ({ ...s, framework: 'nettruyen' }))
        : [{ id: 'nettruyen', label: 'NetTruyen', base: config.NETTRUYEN_BASE, prefix: 'ot~', framework: 'nettruyen' }]);
    const map = new Map();
    for (const s of [...fromCfg, ...customSites()]) {
      map.set(s.id, { framework: 'nettruyen', label: s.id, ...s });
    }
    return [...map.values()];
  }

  /** REGISTRY đầy đủ để chọn nguồn chính: TruyenQQ + các nguồn phụ. */
  function registry() {
    return [
      { id: 'truyenqq', label: 'TruyenQQ', prefix: '', framework: 'truyenqq', base: resolver.current(), primary: true },
      ...secondaryDefs(),
    ];
  }

  /** Dựng adapter cho một nguồn phụ, bọc cache riêng (keyPrefix theo id). */
  const buildSecondary = (site) => ({
    id: site.id,
    label: site.label || site.id,
    prefix: site.prefix,
    framework: site.framework || 'nettruyen',
    src: wrap(db, makeAdapter(site.framework, { base: site.base, apiBase: site.apiBase || '' }),
      { keyPrefix: `sup:${site.id}:`, detailTtlMs: 60 * 60 * 1000, chapterTtlMs: 7 * DAY }),
  });

  const newSecondaries = () => secondaryDefs().map(buildSecondary);

  // 'otruyen' là ALIAS lịch sử: nguồn chính = nguồn phụ đầu tiên.
  const primaryIdOf = (name) => (name === 'otruyen' ? (secondaryDefs()[0]?.id || 'truyenqq') : name);
  const isValidSource = (name) => name === 'otruyen' || registry().some(s => s.id === name);

  let raw, active, parts = {};

  function buildRaw(name) {
    const primaryId = primaryIdOf(name);

    if (primaryId === 'truyenqq') {
      const qq = makeTruyenQQ({ base: resolver.current(), reprobe: () => resolver.reprobe() });
      // TruyenQQ chính, các kho bổ sung những bộ TruyenQQ không có. Tắt: supplement=0.
      if (settings.get('supplement', '1') === '0') { parts = { primary: qq, supplements: [] }; return qq; }
      const sups = newSecondaries();
      parts = { primary: qq, supplements: sups };
      return combine(qq, sups);
    }

    // Nguồn phụ TỰ CHỌN làm chính: đứng riêng (không gộp, slug không tiền tố), như
    // hành vi 'otruyen' cũ. Vẫn liệt kê mọi kho ở comicSources để trang đọc đổi nguồn.
    const sups = newSecondaries();
    const chosen = sups.find(s => s.id === primaryId) || sups[0];
    parts = { primary: null, supplements: sups, activeId: chosen?.id };
    return chosen?.src;
  }

  function build(name) {
    raw = buildRaw(name);
    // detailTtlMs 5': mở trang chi tiết (mục lục) lần 2 gần như tức thì. Nhờ
    // stale-while-revalidate, hết 5' vẫn trả ngay bản cũ + làm mới ở nền.
    active = wrap(db, raw, { searchTtlMs: 10 * 60 * 1000, detailTtlMs: 5 * 60 * 1000 });
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

    /**
     * Các nguồn truyện tranh tìm-riêng-được (để "đổi nguồn" ở trang đọc). Mỗi mục:
     * id, label, prefix slug (''=TruyenQQ), src (đã bọc cache).
     */
    comicSources() {
      const list = [];
      if (parts.primary) list.push({ id: 'truyenqq', label: 'TruyenQQ', prefix: '', src: parts.primary });
      for (const s of parts.supplements || []) list.push({ id: s.id, label: s.label, prefix: s.prefix, src: s.src });
      return list;
    },

    /** REGISTRY để trang Cài đặt hiện danh sách chọn nguồn (kèm nguồn nào đang chính). */
    listRegistry() {
      const cur = primaryIdOf(settings.get('source', 'truyenqq'));
      return registry().map(s => ({
        id: s.id, label: s.label, base: s.base, prefix: s.prefix,
        framework: s.framework, active: s.id === cur,
      }));
    },

    /** Mọi tiền tố slug đang biết (để dọn bộ mồ côi lúc khởi động). */
    knownPrefixes: () => secondaryDefs().map(s => s.prefix).filter(Boolean),

    /** Đổi nguồn chính (id bất kỳ trong registry, hoặc alias 'otruyen'). */
    setSource(name) {
      if (!isValidSource(name)) throw new Error('Nguồn không hợp lệ: ' + name);
      settings.set('source', name);
      build(name);
      clearCache();
      return name;
    },

    /** Đang bật bổ sung? */
    supplementOn: () => settings.get('supplement', '1') !== '0',

    /**
     * Bật/tắt bổ sung. Dựng lại + xóa cache vì kết quả đã cache là bản ĐÃ gộp.
     * Chỉ có tác dụng khi nguồn chính là truyenqq.
     */
    setSupplement(on) {
      settings.set('supplement', on ? '1' : '0');
      build(settings.get('source', 'truyenqq'));
      clearCache();
      return on;
    },

    /**
     * Thêm một nguồn mới (thường sau khi "Dò nguồn từ máy chủ" nhận ra khung).
     * Lưu vào settings, dựng lại registry. Trả về site đã thêm.
     */
    addSite({ id, label, base, prefix, framework = 'nettruyen', apiBase = '' } = {}) {
      const origin = safeTarget(base);
      if (!origin) throw new Error('Địa chỉ nguồn không hợp lệ');
      if (!['truyenqq', 'nettruyen', 'toptruyen'].includes(framework)) {
        throw new Error('Khung chưa hỗ trợ (chưa có adapter): ' + framework);
      }
      const host = new URL(origin).hostname.replace(/^www\./, '');
      const sid = String(id || host.split('.')[0]).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'src';
      const pre = String(prefix || sid).replace(/[^a-z0-9]+/g, '').slice(0, 8) + '~';
      const taken = new Set(registry().map(s => s.prefix));
      if (taken.has(pre)) throw new Error('Tiền tố đã dùng: ' + pre);
      if (registry().some(s => s.id === sid)) throw new Error('Nguồn đã có: ' + sid);

      const site = { id: sid, label: label || host, base: origin, prefix: pre, framework, ...(apiBase ? { apiBase } : {}) };
      const list = [...customSites().filter(s => s.id !== sid), site];
      settings.set(CUSTOM_KEY, JSON.stringify(list));
      build(settings.get('source', 'truyenqq'));
      clearCache();
      return site;
    },

    /** Gỡ một nguồn người dùng đã thêm (không đụng nguồn cài sẵn). */
    removeSite(id) {
      const custom = customSites();
      if (!custom.some(s => s.id === id)) throw new Error('Chỉ gỡ được nguồn tự thêm');
      settings.set(CUSTOM_KEY, JSON.stringify(custom.filter(s => s.id !== id)));
      // Đang lấy nguồn này làm chính thì quay về TruyenQQ.
      if (primaryIdOf(settings.get('source', 'truyenqq')) === id) settings.set('source', 'truyenqq');
      build(settings.get('source', 'truyenqq'));
      clearCache();
      return id;
    },

    /** Đổi domain TruyenQQ thủ công (đã kiểm tra sống ở tầng route). */
    applyDomain(base) {
      resolver.setCurrent(base);
      if (raw && typeof raw.setBase === 'function') raw.setBase(resolver.current());
      clearCache();
      return resolver.current();
    },

    /** Dò lại ngay: tìm domain sống, áp dụng, xóa cache. Ném lỗi nếu tất cả chết. */
    async reprobe() {
      const found = await resolver.reprobe();
      if (raw && typeof raw.setBase === 'function') raw.setBase(found);
      clearCache();
      return found;
    },
  };
}
