import * as cheerio from 'cheerio';
import { cleanSynopsis, scrubBrands } from './clean.js';

/**
 * Nguồn BỔ SUNG truyện tranh: NetTruyen (crawl HTML) — thay cho client OTruyen API
 * cũ sau khi API đọc chương của OTruyen chết (sv1.otruyencdn.com/v1/api/chapter
 * trả 404/timeout). NetTruyen phục vụ cùng kho truyện nhưng có hạ tầng ảnh còn
 * sống (nettruyen-api.clubc.org cho bìa, images.truyenonline.cc cho ảnh chương).
 *
 * Cùng giao diện với các nguồn khác (home/list/search/categories/byCategory/
 * detail/chapter). chapter() trả { images } như nguồn tranh.
 */

export const SEL = {
  card: '.items .item',
  cardLink: 'a',
  cardTitle: 'figcaption h3 a, h3 a, .title a, h3',
  cardImg: 'img',
  cardChapter: '.comic-item a, ul li a, .chapter a',

  title: 'h1.title-detail, .title-detail, h1',
  author: 'li.author .col-xs-8',
  status: 'li.status .col-xs-8',
  kindLi: 'li.kind',
  cover: '.col-image img, .detail-info img, [itemprop="image"]',
  synopsis: '.detail-content, .shortdes, [itemprop="description"]',
  chapterRow: '.list-chapter li a, #nt_listchapter a, nav .chapter a',

  pageImg: '.page-chapter img, .reading-detail img',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const abs = (base, url) => { try { return new URL(url, base).href; } catch { return ''; } };

/** /truyen-tranh/dai-chua-te -> dai-chua-te */
export function slugFromHref(href) {
  const m = String(href || '').match(/\/truyen-tranh\/([^/?#]+)(?:\/chuong-[^/?#]+)?\/?(?:$|[?#])/i);
  return m ? m[1] : '';
}

/** "Chapter 252: END" / "Chương 89.5" -> { name: '252', title: 'END' } */
export function parseChapterName(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/ch(?:apter|ương|uong)\s*([\d.]+)\s*:?\s*(.*)$/i);
  if (m) return { name: m[1], title: (m[2] || '').trim() };
  return { name: s, title: '' };
}

export function createNetTruyenSource({
  base = 'https://nettruyen.id',
  apiBase = 'https://nettruyen-api.clubc.org',   // API JSON: search + host ảnh bìa
  fetchFn = fetch,
  retries = 2,
  retryDelayMs = 600,
  politeDelayMs = 400,
} = {}) {
  base = base.replace(/\/+$/, '');
  apiBase = apiBase.replace(/\/+$/, '');
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
      const slug = slugFromHref($el.find(SEL.cardLink).first().attr('href'));
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      const $img = $el.find(SEL.cardImg).first();
      const name = ($el.find(SEL.cardTitle).first().text() || $img.attr('alt') || '').trim();
      const thumb = $img.attr('data-src') || $img.attr('data-original') || $img.attr('src') || '';
      items.push({
        slug,
        name: scrubBrands(name),
        thumbUrl: abs(base, thumb),
        status: null,
        categories: [],
        updatedAt: null,
        latestChapter: parseChapterName($el.find(SEL.cardChapter).first().text()).name || null,
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
    id: 'nettruyen',
    label: 'NetTruyen',

    setBase(nb) { if (nb) base = nb.replace(/\/+$/, ''); },
    getBase() { return base; },

    async home() {
      return { items: (await listPage('/', 1)).items, pagination: null };
    },

    async list(type = 'truyen-moi', page = 1) {
      return listPage('/', page);
    },

    async byCategory(slug, page = 1) {
      return listPage(`/the-loai/${slug}`, page);
    },

    async categories() {
      const $ = await load(`${base}/`);
      const seen = new Map();
      $('a[href*="/the-loai/"]').each((_, a) => {
        const href = String($(a).attr('href') || '');
        const m = href.match(/\/the-loai\/([a-z0-9-]+)\/?$/i);
        const name = $(a).text().trim();
        if (m && name && !seen.has(m[1])) seen.set(m[1], { name: scrubBrands(name), slug: m[1] });
      });
      return [...seen.values()];
    },

    // Tìm kiếm qua API JSON của NetTruyen (param đúng là 'keyword', 'q' bị bỏ qua).
    async search(keyword) {
      let body;
      try {
        const res = await fetchFn(`${apiBase}/api/comics/search?keyword=${encodeURIComponent(keyword)}`,
          { headers: { 'User-Agent': UA, Accept: 'application/json' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        body = await res.json();
      } catch { return { items: [], pagination: null }; }
      const items = (body.comics || []).map(c => ({
        slug: c.slug,
        name: scrubBrands(c.name || ''),
        thumbUrl: c.thumbnail ? abs(apiBase, c.thumbnail) : '',
        status: /ho[àa]n|full/i.test(c.status || '') ? 'completed' : null,
        categories: [],
        updatedAt: null,
        latestChapter: parseChapterName(c.last_chapter?.name || c.last_chapter || '').name || null,
      }));
      return { items, pagination: null };
    },

    async detail(slug) {
      const $ = await load(`${base}/truyen-tranh/${slug}`);
      const statusText = $(SEL.status).first().text().trim();

      // Thể loại: lấy từ text của li "Thể loại", bỏ nhãn + tách theo " - "
      // (dùng text thay vì link để tránh lẫn link quảng bá trong cùng li).
      const kindText = $(SEL.kindLi).first().text().replace(/\s+/g, ' ').trim()
        .replace(/^th[eể]\s*lo[aạ]i\s*:?/i, '').trim();
      const categories = kindText.split(/\s*-\s*/).map(s => scrubBrands(s.trim()))
        .filter(s => s && !/nettruyen/i.test(s));

      const chapters = [];
      const seenCh = new Set();
      $(SEL.chapterRow).each((_, a) => {
        const href = $(a).attr('href');
        if (!href) return;
        const { name, title } = parseChapterName($(a).text());
        if (!name || seenCh.has(name)) return;
        seenCh.add(name);
        chapters.push({ name, title, apiUrl: abs(base, href), order: 0 });
      });
      chapters.reverse();  // trang liệt kê chương mới nhất trước -> đảo tăng dần
      chapters.forEach((c, i) => { c.order = i; });

      const $cov = $(SEL.cover).first();
      return {
        slug,
        name: scrubBrands($(SEL.title).first().text().trim()),
        origin: '',
        content: cleanSynopsis($(SEL.synopsis).first().html() || ''),
        status: /ho[àa]n|full/i.test(statusText) ? 'completed' : 'ongoing',
        thumbUrl: abs(base, $cov.attr('data-src') || $cov.attr('src') || ''),
        categories,
        author: (() => { const a = $(SEL.author).first().text().trim(); return /đang cập nhật/i.test(a) ? '' : scrubBrands(a); })(),
        updatedAt: null,
        chapters,
      };
    },

    /** chapterUrl là URL trang đọc chương (lấy từ detail.chapters[].apiUrl). */
    async chapter(chapterUrl) {
      const $ = await load(chapterUrl);
      const images = [];
      $(SEL.pageImg).each((_, el) => {
        const $el = $(el);
        const src = $el.attr('data-src') || $el.attr('data-original') || $el.attr('src') || $el.attr('data-cdn');
        if (!src) return;
        images.push({ page: images.length, url: abs(base, src.trim()) });
      });
      return { images };
    },
  };
}
