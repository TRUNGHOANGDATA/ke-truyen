import * as cheerio from 'cheerio';
import { cleanSynopsis, scrubBrands } from './clean.js';

/**
 * Nguồn TopTruyen (toptruyenzonee.com và các site cùng khung) — crawl HTML.
 *
 * Khung RIÊNG, khác cả TruyenQQ lẫn NetTruyen:
 *   - Trang chi tiết BẮT BUỘC có id: /truyen-tranh/<name>/<id> (bỏ id -> 404),
 *     nên slug web lưu phải kèm id. Quy ước: slug = "<name>~<id>", detail() tách
 *     dấu '~' cuối để dựng lại URL. (Dấu '~' vẫn an toàn cho URL + không đụng tới
 *     tiền tố kho bổ sung vì tiền tố đã bị bóc TRƯỚC khi tới adapter.)
 *   - Danh sách/trang chủ: /tim-truyen?page=N ; thể loại: /tim-truyen/<cat>?page=N
 *   - Tìm kiếm: /tim-truyen?keyword=... (trả HTML card như trang danh sách).
 *   - Mục lục ĐẦY ĐỦ nằm sẵn trong HTML (không cần endpoint AJAX như NetTruyen),
 *     nhưng có chèn vài "chương" quảng cáo trỏ sang truyện khác -> lọc theo name.
 *
 * Cùng bộ phương thức với các nguồn khác. chapter() trả { images } như nguồn tranh.
 */

export const SEL = {
  // Thẻ truyện trong trang danh sách / kết quả tìm kiếm
  card: '.item',
  cardLink: '.caption h3 a, a.title-manga',
  cardImg: '.image-item img, img.image-item',
  cardChapter: '.chapter-detail a, ul li a',

  // Trang chi tiết
  title: '.overview-comic h1, h1',
  author: 'li.author .detail-info',
  status: 'li.status .detail-info',
  genres: 'li.category .cat-detail a, li.category a[href*="/tim-truyen/"]',
  synopsis: '.detail-summary, .summary-content, [itemprop="description"]',
  cover: 'img.image-comic',
  chapterRow: 'nav ul li.row .chapters a.chapter, .chapters a.chapter',

  // Trang đọc chương
  pageImg: '.list-image-detail .page-chapter img, .page-chapter img',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const abs = (base, url) => {
  if (!url) return '';
  let u = String(url).trim();
  if (u.startsWith('//')) u = 'https:' + u;   // link giao thức tương đối //host/...
  try { return new URL(u, base).href; } catch { return ''; }
};

/** "Chapter 705" / "Chương 89.5" -> "705" */
export function chapterLabel(raw) {
  const m = String(raw || '').match(/([\d.]+)\s*(?::.*)?$/);
  return m ? m[1] : String(raw || '').trim();
}

/**
 * href thẻ truyện -> { name, id, slug } ; null nếu không phải link truyện.
 * Link truyện: /truyen-tranh/<name>/<id-số>  (link CHƯƠNG có 'chapter-...' ở giữa
 * nên khúc sau name không phải toàn số -> tự loại).
 */
export function parseComicHref(href) {
  const m = String(href || '').match(/\/truyen-tranh\/([a-z0-9-]+)\/(\d+)(?:[/?#]|$)/i);
  return m ? { name: m[1], id: m[2], slug: `${m[1]}~${m[2]}` } : null;
}

/** slug "<name>~<id>" -> { name, id } ; chấp nhận cả slug thiếu id (dò lại sau). */
export function splitSlug(slug) {
  const s = String(slug || '');
  const i = s.lastIndexOf('~');
  if (i < 0) return { name: s, id: '' };
  return { name: s.slice(0, i), id: s.slice(i + 1) };
}

export function createTopTruyenSource({
  base = 'https://www.toptruyenzonee.com',
  fetchFn = fetch,
  retries = 2,
  retryDelayMs = 600,
  politeDelayMs = 400,
} = {}) {
  base = base.replace(/\/+$/, '');
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  let lastCall = 0;

  async function polite() {
    const wait = politeDelayMs - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  }

  async function fetchText(url, timeoutMs = 12000) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        await polite();
        const res = await fetchFn(url, {
          headers: { 'User-Agent': UA, Referer: base + '/', 'Accept-Language': 'vi,en;q=0.8' },
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} cho ${url}`);
        const text = await res.text();
        if (!text || text.length < 200) throw new Error(`Trang rỗng bất thường: ${url}`);
        return text;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  const load = async (url) => cheerio.load(await fetchText(url));

  function parseCards($) {
    const items = [];
    const seen = new Set();
    $(SEL.card).each((_, el) => {
      const $el = $(el);
      const parsed = parseComicHref($el.find(SEL.cardLink).first().attr('href'));
      if (!parsed || seen.has(parsed.slug)) return;
      seen.add(parsed.slug);
      const $img = $el.find(SEL.cardImg).first();
      const name = ($el.find(SEL.cardLink).first().text() || $img.attr('alt') || '').trim();
      const thumb = $img.attr('data-src') || $img.attr('src') || $img.attr('data-original') || '';
      items.push({
        slug: parsed.slug,
        name: scrubBrands(name),
        thumbUrl: abs(base, thumb),
        status: null,
        categories: [],
        updatedAt: null,
        latestChapter: chapterLabel($el.find(SEL.cardChapter).first().text()) || null,
      });
    });
    return items;
  }

  const pageParam = (url, page) => (page > 1 ? `${url}${url.includes('?') ? '&' : '?'}page=${page}` : url);

  async function listPage(path, page) {
    const $ = await load(pageParam(`${base}${path}`, page));
    return { items: parseCards($), pagination: { currentPage: page } };
  }

  return {
    id: 'toptruyen',
    label: 'TopTruyen',

    setBase(nb) { if (nb) base = nb.replace(/\/+$/, ''); },
    getBase() { return base; },

    async home() {
      return { items: (await listPage('/tim-truyen', 1)).items, pagination: null };
    },

    async list(type = 'truyen-moi', page = 1) {
      return listPage('/tim-truyen', page);
    },

    async byCategory(slug, page = 1) {
      return listPage(`/tim-truyen/${slug}`, page);
    },

    async categories() {
      const $ = await load(`${base}/tim-truyen`);
      const seen = new Map();
      $('a[href*="/tim-truyen/"]').each((_, a) => {
        const href = String($(a).attr('href') || '');
        const m = href.match(/\/tim-truyen\/([a-z0-9-]+)\/?(?:[?#]|$)/i);
        const name = $(a).text().trim();
        if (m && name && !seen.has(m[1])) seen.set(m[1], { name: scrubBrands(name), slug: m[1] });
      });
      return [...seen.values()];
    },

    async search(keyword) {
      try {
        const $ = await load(`${base}/tim-truyen?keyword=${encodeURIComponent(keyword)}`);
        return { items: parseCards($), pagination: null };
      } catch { return { items: [], pagination: null }; }
    },

    async detail(slug) {
      const { name: comicName, id } = splitSlug(slug);
      const $ = await load(`${base}/truyen-tranh/${comicName}/${id}`);
      const statusText = $(SEL.status).first().text().trim();
      const authorText = $(SEL.author).first().text().trim();

      // Mục lục có chèn vài "chương" quảng cáo trỏ sang TRUYỆN KHÁC (name khác).
      // Lọc theo NHÓM name PHỔ BIẾN NHẤT (chính là bộ thật) thay vì so với slug —
      // vì site định tuyến theo id nên name trên URL có thể khác slug đã lưu (vd
      // slug còn mang tiền tố kho bổ sung 'ttz~'): so với slug sẽ loại nhầm sạch chương.
      const rows = [];
      $(SEL.chapterRow).each((_, a) => {
        const href = String($(a).attr('href') || '');
        const cm = href.match(/\/truyen-tranh\/([a-z0-9-]+)\/chapter-[^/?#]+/i);
        if (!cm) return;
        const num = $(a).attr('data-chapter') || chapterLabel($(a).text());
        if (!num) return;
        rows.push({ name: cm[1], num: String(num), href });
      });
      const freq = {};
      for (const r of rows) freq[r.name] = (freq[r.name] || 0) + 1;
      const canonical = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
      const chapters = [];
      const seen = new Set();
      for (const r of rows) {
        if (r.name !== canonical) continue;                     // row quảng cáo (name thiểu số) -> bỏ
        if (seen.has(r.num)) continue;
        seen.add(r.num);
        chapters.push({ name: r.num, title: '', apiUrl: abs(base, r.href), updatedAt: null, order: 0 });
      }
      chapters.reverse();                                        // trang liệt kê mới-trước
      chapters.forEach((c, i) => { c.order = i; });

      const $cov = $(SEL.cover).first();

      // Slug lạ (của nguồn khác) khiến site trả về TRANG DANH SÁCH / trang "404!"
      // (vẫn HTTP 200) thay vì trang truyện. Trang truyện thật luôn có bìa
      // `img.image-comic`; vắng bìa mà lại 0 chương = không phải trang truyện ->
      // báo lỗi gọn thay vì dựng một "truyện" rỗng mang tên trang danh sách.
      if (!chapters.length && !$cov.length) {
        throw new Error(`Không đọc được ở nguồn này (slug thuộc nguồn khác): ${slug}`);
      }
      return {
        slug,
        name: scrubBrands($(SEL.title).first().text().trim()),
        origin: '',
        content: cleanSynopsis($(SEL.synopsis).first().html() || ''),
        status: /ho[àa]n|full/i.test(statusText) ? 'completed' : 'ongoing',
        thumbUrl: abs(base, $cov.attr('data-src') || $cov.attr('src') || ''),
        categories: $(SEL.genres).map((_, a) => scrubBrands($(a).text().trim())).get().filter(Boolean),
        author: /đang cập nhật/i.test(authorText) ? '' : scrubBrands(authorText),
        updatedAt: null,
        chapters,
      };
    },

    /** chapterUrl = URL trang đọc chương (lấy từ detail.chapters[].apiUrl). */
    async chapter(chapterUrl) {
      const $ = await load(chapterUrl);
      const images = [];
      $(SEL.pageImg).each((_, el) => {
        const $el = $(el);
        const src = $el.attr('data-src') || $el.attr('data-original') || $el.attr('src') || $el.attr('data-cdn');
        if (!src) return;
        const url = abs(base, src.trim());
        // Bỏ ảnh banner/logo chèn đầu chương (không phải trang truyện).
        if (!url || /\/comics\/top\/|topzonee|\/images\/background\//i.test(url)) return;
        images.push({ page: images.length, url });
      });
      return { images };
    },
  };
}
