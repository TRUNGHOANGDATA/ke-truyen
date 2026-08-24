/**
 * "Bộ này đọc được ở những nguồn nào" — dùng chung cho trang đọc và /api.
 *
 * Phép tra rất đắt: phải gọi search() tới TỪNG nguồn (~2-3 giây). Nhưng câu trả
 * lời gần như cố định theo từng bộ, nên chỉ nhớ ánh xạ *bộ -> slug ở từng nguồn*
 * (12 tiếng); số chương ghép vào lúc dựng link nên chương nào cũng ra đúng link.
 *
 * Ba lối vào, theo độ "sẵn sàng":
 *   - cached(): CHỈ đọc cache, không chạm mạng -> trang đọc dựng sẵn nút ngay từ
 *     HTML, không phải chèn muộn làm nhảy thanh header.
 *   - warm():   tra ngầm lúc mở trang chi tiết, để tới lúc bấm đọc thì đã có sẵn.
 *   - list():   tra thật (có cache) — cho /api khi chưa kịp làm ấm.
 */
import { titleKey } from '../source/title-key.js';

const TTL = 12 * 60 * 60 * 1000;

export function createAltSources({ manager, kv }) {
  const sourcesOf = () => (manager?.comicSources ? manager.comicSources() : []);
  const keyFor = (all, name) => `${all.map(s => s.id).join('+')}:${titleKey(name)}`;

  /** Tìm bộ ở từng nguồn. Nguồn lỗi thì bỏ qua, không làm chết cả phép tra. */
  async function resolve(all, name) {
    const key = titleKey(name);
    const out = [];
    await Promise.all(all.map(async (cs) => {
      try {
        const items = (await cs.src.search(name)).items || [];
        const hit = items.find(i => titleKey(i.name) === key)
          || items.find(i => titleKey(i.name).includes(key) || key.includes(titleKey(i.name)));
        if (hit) out.push({ id: cs.id, slug: hit.slug });
      } catch { /* nguồn lỗi thì bỏ qua */ }
    }));
    return out;
  }

  /** Ghép ánh xạ đã tra + slug đang đọc thành danh sách nút cho trang đọc. */
  function build(all, found, slug, chapter) {
    const curPrefix = all.map(s => s.prefix).filter(Boolean).find(p => slug.startsWith(p)) || '';
    const bySrc = new Map((found || []).map(f => [f.id, f.slug]));
    return all.map((cs, i) => {
      const current = cs.prefix === curPrefix;
      // Nguồn đang đọc luôn có mặt: slug của nó đã biết sẵn từ URL.
      const s = current ? slug.slice(cs.prefix.length) : bySrc.get(cs.id);
      if (!s) return null;
      return { n: i + 1, id: cs.id, label: cs.label, current,
        url: `/doc/${cs.prefix}${s}/${encodeURIComponent(chapter)}` };
    }).filter(Boolean);
  }

  return {
    /** Chỉ lấy từ cache (đồng bộ, không chạm mạng). Chưa có thì trả null. */
    cached(slug, name, chapter) {
      const all = sourcesOf();
      if (!name || !all.length || !kv) return null;
      const found = kv.get(keyFor(all, name));
      return found === undefined ? null : build(all, found, slug, chapter);
    },

    /** Tra thật (dùng lại cache nếu có). */
    async list(slug, name, chapter) {
      const all = sourcesOf();
      if (!name || !all.length) return [];
      const k = keyFor(all, name);
      const found = kv ? await kv.wrap(k, TTL, () => resolve(all, name)) : await resolve(all, name);
      return build(all, found, slug, chapter);
    },

    /**
     * Làm ấm ngầm lúc mở trang chi tiết. Không chờ, không ném lỗi: đây chỉ là
     * tối ưu, hỏng thì trang đọc tự tra lại như cũ.
     */
    warm(name) {
      const all = sourcesOf();
      if (!name || !all.length || !kv) return;
      const k = keyFor(all, name);
      if (kv.get(k) !== undefined) return;             // đã có thì thôi
      Promise.resolve().then(() => kv.wrap(k, TTL, () => resolve(all, name))).catch(() => {});
    },
  };
}
