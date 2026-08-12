import * as cheerio from 'cheerio';
import { cleanSynopsis, scrubBrands } from './clean.js';

/**
 * Nguồn TruyenQQ (crawl HTML).
 *
 * Cùng giao diện với nguồn OTruyen (home/list/search/categories/byCategory/
 * detail/chapter) nên phần còn lại của web không cần biết đang dùng nguồn nào.
 *
 * Mọi selector gom vào SEL: TruyenQQ đổi layout thì chỉ sửa ở đây.
 */

export const SEL = {
  // Thẻ truyện trong các trang danh sách
  card: 'ul.list_grid li',
  cardLink: '.book_avatar a',
  cardImg: '.book_avatar img',
  cardTitle: '.book_name h3 a',
  cardTime: '.time-ago',
  cardLastChapter: '.last_chapter a',

  // Trang chi tiết truyện
  title: '.book_other h1',
  otherName: 'li.othername .other-name',
  author: 'li.author p.col-xs-9',
  status: 'li.status p.col-xs-9',
  genres: 'ul.list01 li a',
  synopsis: '.story-detail-info',
  detailCover: '.book_avatar img',
  chapterRow: '.works-chapter-item',
  chapterLink: '.name-chap a',
  chapterTime: '.time-chap',

  // Trang đọc chương
  pageImg: '.page-chapter img',

  // Kết quả tìm kiếm (mảnh HTML trả về từ endpoint AJAX)
  searchRow: 'li',
  searchLink: 'a',
  searchImg: 'img',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** "1 Phút Trước" / "3 Giờ Trước" / "12/08/2026" -> ISO string */
export function parseVnTime(raw, now = Date.now()) {
  const s = String(raw || '').trim();
  if (!s) return null;

  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return new Date(Date.UTC(+y, +m - 1, +d)).toISOString();
  }

  const rel = s.match(/^(\d+)\s*(Giây|Phút|Giờ|Ngày|Tuần|Tháng|Năm)\s*Trước$/i);
  if (rel) {
    const n = +rel[1];
    const unit = rel[2].toLowerCase();
    const ms = { 'giây': 1e3, 'phút': 6e4, 'giờ': 36e5, 'ngày': 864e5,
                 'tuần': 6048e5, 'tháng': 2592e6, 'năm': 31536e6 }[unit];
    if (ms) return new Date(now - n * ms).toISOString();
  }
  return null;
}

/** Lấy số chương từ "Chapter 110" / "Chương 89.5" */
export function chapterLabel(raw) {
  const m = String(raw || '').match(/([\d.]+)\s*$/);
  return m ? m[1] : String(raw || '').trim();
}

const abs = (base, url) => {
  if (!url) return '';
  try { return new URL(url, base).href; } catch { return ''; }
};

/** /truyen-tranh/nguyen-ton-3755 -> nguyen-ton-3755 */
const slugFromHref = (href) => {
  const m = String(href || '').match(/\/truyen-tranh\/([^/?#]+?)(?:-chap-[\d.]+)?\/?$/);
  return m ? m[1] : '';
};

export function createTruyenQQSource({
  base = 'https://truyenqqko.com',
  fetchFn = fetch,
  retries = 2,
  retryDelayMs = 600,
  politeDelayMs = 400,
} = {}) {
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  let lastCall = 0;

  async function polite() {
    const wait = politeDelayMs - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  }

  async function fetchText(url, init = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        await polite();
        const res = await fetchFn(url, {
          ...init,
          headers: { 'User-Agent': UA, Referer: base + '/', 'Accept-Language': 'vi,en;q=0.8', ...(init.headers || {}) },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} cho ${url}`);
        const text = await res.text();
        if (!text || text.length < 200) throw new Error(`Trang rỗng bất thường: ${url}`);
        return text;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
      }
    }
    throw lastErr;
  }

  const load = async (url, init) => cheerio.load(await fetchText(url, init));

  /** Đọc các thẻ truyện trong một trang danh sách */
  function parseCards($) {
    const items = [];
    $(SEL.card).each((_, el) => {
      const $el = $(el);
      const href = $el.find(SEL.cardLink).attr('href');
      const slug = slugFromHref(href);
      if (!slug) return;
      const $img = $el.find(SEL.cardImg).first();
      const name = ($el.find(SEL.cardTitle).first().text() || $img.attr('alt') || '').trim();
      const thumb = $img.attr('src') || $img.attr('data-fb') || $img.attr('data-original') || '';
      items.push({
        slug,
        name,
        thumbUrl: abs(base, thumb),
        status: null,
        categories: [],
        updatedAt: parseVnTime($el.find(SEL.cardTime).first().text()),
        latestChapter: chapterLabel($el.find(SEL.cardLastChapter).first().text()),
      });
    });
    return items;
  }

  /** TruyenQQ không trả tổng số truyện; suy ra phân trang từ số trang thấy được */
  function parsePagination($, page) {
    const pages = new Set();
    $('a[href*="/trang-"]').each((_, a) => {
      const m = String($(a).attr('href')).match(/\/trang-(\d+)/);
      if (m) pages.add(+m[1]);
    });
    const maxSeen = pages.size ? Math.max(...pages) : page;
    const per = 42; // TruyenQQ trả 42 truyện mỗi trang
    return { totalItems: maxSeen * per, totalItemsPerPage: per, currentPage: page, pageRanges: 5 };
  }

  const listUrl = (path, page) => `${base}${path}${page > 1 ? `/trang-${page}` : ''}`;

  async function listPage(path, page) {
    const $ = await load(listUrl(path, page));
    return { items: parseCards($), pagination: parsePagination($, page) };
  }

  return {
    id: 'truyenqq',
    label: 'TruyenQQ',

    async home() {
      const { items } = await listPage('/truyen-moi-cap-nhat', 1);
      return { items, pagination: null };
    },

    async list(type = 'truyen-moi', page = 1) {
      // Nguồn này chỉ có một danh sách chính: truyện mới cập nhật
      return listPage('/truyen-moi-cap-nhat', page);
    },

    /**
     * Thể loại: slug dạng "action-26" (kèm id của TruyenQQ).
     * Trang thể loại của TruyenQQ không sắp theo thời gian cập nhật và tham số
     * sort của họ không dùng được, nên tự sắp lại: mới cập nhật lên trước.
     */
    async byCategory(slug, page = 1) {
      const res = await listPage(`/the-loai/${slug}`, page);
      res.items.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
      return res;
    },

    async categories() {
      const $ = await load(`${base}/doc-truyen`);
      const seen = new Map();
      $('a[href*="/the-loai/"]').each((_, a) => {
        const href = String($(a).attr('href') || '');
        const m = href.match(/\/the-loai\/([a-z0-9-]+-\d+)/i);
        const name = $(a).text().trim();
        if (m && name && !seen.has(m[1])) seen.set(m[1], { name, slug: m[1] });
      });
      return [...seen.values()];
    },

    /** Tìm kiếm dùng endpoint AJAX của TruyenQQ (GET /tim-kiem trả rỗng) */
    async search(keyword) {
      const html = await fetchText(`${base}/frontend/search/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: `search=${encodeURIComponent(keyword)}`,
      }).catch(() => '');
      if (!html) return { items: [], pagination: null };
      const $ = cheerio.load(html);
      const items = [];
      $(SEL.searchRow).each((_, el) => {
        const $el = $(el);
        const slug = slugFromHref($el.find(SEL.searchLink).attr('href'));
        if (!slug) return;
        const $img = $el.find(SEL.searchImg).first();
        const name = ($el.find('h3').text() || $img.attr('alt') || $el.text()).trim().split('\n')[0];
        items.push({
          slug, name, thumbUrl: abs(base, $img.attr('src') || ''),
          status: null, categories: [], updatedAt: null, latestChapter: null,
        });
      });
      return { items, pagination: null };
    },

    async detail(slug) {
      const $ = await load(`${base}/truyen-tranh/${slug}`);
      const statusText = $(SEL.status).first().text().trim();
      const authorText = $(SEL.author).first().text().trim();

      const chapters = [];
      $(SEL.chapterRow).each((_, el) => {
        const $el = $(el);
        const $a = $el.find(SEL.chapterLink).first();
        const href = $a.attr('href');
        if (!href) return;
        chapters.push({
          name: chapterLabel($a.text()),
          title: '',
          apiUrl: abs(base, href),
          updatedAt: parseVnTime($el.find(SEL.chapterTime).first().text()),
          order: 0,
        });
      });
      // Trang liệt kê chương mới nhất trước; đảo lại cho tăng dần rồi đánh số
      chapters.reverse();
      chapters.forEach((c, i) => { c.order = i; });

      const $img = $(SEL.detailCover).first();
      return {
        slug,
        name: scrubBrands($(SEL.title).first().text().trim()),
        origin: scrubBrands($(SEL.otherName).first().text().trim()),
        // Bỏ thẻ HTML + đoạn SEO/quảng bá + tên nguồn
        content: cleanSynopsis($(SEL.synopsis).first().html() || ''),
        status: /hoàn/i.test(statusText) ? 'completed' : 'ongoing',
        thumbUrl: abs(base, $img.attr('src') || $img.attr('data-fb') || ''),
        categories: $(SEL.genres).map((_, a) => $(a).text().trim()).get().filter(Boolean),
        // Ô tác giả ghi tên trang nguồn nghĩa là không rõ tác giả
        author: /^truyenqq|đang cập nhật/i.test(authorText) ? '' : scrubBrands(authorText),
        updatedAt: chapters.at(-1)?.updatedAt || null,
        chapters,
      };
    },

    /** chapterUrl là URL trang đọc chương (lấy từ detail.chapters[].apiUrl) */
    async chapter(chapterUrl) {
      const $ = await load(chapterUrl);
      const images = [];
      $(SEL.pageImg).each((i, el) => {
        const $el = $(el);
        const src = $el.attr('data-original') || $el.attr('src') || $el.attr('data-cdn');
        if (!src) return;
        images.push({ page: images.length, url: abs(base, src) });
      });
      return { images };
    },
  };
}
