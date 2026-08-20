import * as cheerio from 'cheerio';
import { cleanSynopsis, scrubBrands } from './clean.js';

/**
 * Nguồn TRUYỆN CHỮ: truyenfull (crawl HTML). Không có API công khai.
 *
 * Cùng bộ phương thức với nguồn truyện tranh (home/list/search/categories/
 * byCategory/detail/chapter) để tái dùng thư viện/tiến độ, NHƯNG:
 *   - mọi item mang `kind: 'novel'` để giao diện biết đây là truyện chữ,
 *   - `chapter()` trả `{ paragraphs, title }` (đoạn văn) thay vì ảnh.
 *
 * Selector gom vào SEL: truyenfull đổi layout thì chỉ sửa ở đây.
 */

export const SEL = {
  row: '.list-truyen .row, .col-truyen-main .row',
  rowLink: '.truyen-title a',
  rowLatest: '.text-info a, .chapter-text',

  title: 'h3[itemprop="name"]',
  author: '[itemprop="author"]',
  genre: '[itemprop="genre"]',
  cover: '[itemprop="image"]',
  synopsis: '[itemprop="description"]',
  info: '.info div',
  totalPage: '#total-page',
  chapterList: '#list-chapter li a, .list-chapter li a',

  content: '#chapter-c',
  chapterTitle: 'a.chapter-title, h2 a.chapter-title, .chapter-title',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const abs = (base, url) => { try { return new URL(url, base).href; } catch { return ''; } };

/** https://truyenfull.live/dai-chua-te/ -> dai-chua-te */
export function slugFromHref(href) {
  const m = String(href || '').match(/truyenfull\.[a-z]+\/([^/?#]+)\/?(?:$|[?#])/i);
  const bad = new Set(['the-loai', 'danh-sach', 'tim-kiem']);
  return m && !bad.has(m[1]) ? m[1] : '';
}

/** "Chương 12: Tựa đề" -> { name: '12', title: 'Tựa đề' } */
export function parseChapterName(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/ch[uươ]+ng\s*([\d.]+)\s*:?\s*(.*)$/i);
  if (m) return { name: m[1], title: (m[2] || '').trim() };
  return { name: s, title: '' };
}

export function createTruyenfullSource({
  base = 'https://truyenfull.live',
  fetchFn = fetch,
  retries = 2,
  retryDelayMs = 600,
  politeDelayMs = 300,
  listConcurrency = 6,   // số trang mục lục tải song song (chỉ lúc mở chi tiết)
} = {}) {
  base = base.replace(/\/+$/, '');
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
  let lastCall = 0;

  async function polite() {
    const wait = politeDelayMs - (Date.now() - lastCall);
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  }

  async function fetchText(url, { polite: bePolite = true } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (bePolite) await polite();
        const res = await fetchFn(url, {
          headers: { 'User-Agent': UA, Referer: base + '/', 'Accept-Language': 'vi,en;q=0.8' },
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

  const load = async (url, opts) => cheerio.load(await fetchText(url, opts));

  function parseRows($) {
    const items = [];
    const seen = new Set();
    $(SEL.row).each((_, el) => {
      const $el = $(el);
      const $a = $el.find(SEL.rowLink).first();
      const slug = slugFromHref($a.attr('href'));
      if (!slug || seen.has(slug)) return;
      seen.add(slug);
      const thumb = $el.find('[data-image]').first().attr('data-image') || $el.find('img').attr('src') || '';
      items.push({
        kind: 'novel',
        slug,
        name: scrubBrands($a.text().trim()),
        thumbUrl: abs(base, thumb),
        status: null,
        categories: [],
        updatedAt: null,
        latestChapter: parseChapterName($el.find(SEL.rowLatest).first().text()).name || null,
      });
    });
    return items;
  }

  const listUrl = (path, page) => `${base}${path}${page > 1 ? `trang-${page}/` : ''}`;

  async function listPage(path, page) {
    const $ = await load(listUrl(path, page));
    return { items: parseRows($), pagination: { currentPage: page } };
  }

  /** Lấy toàn bộ mục lục: trang 1 đã có $, các trang 2..N tải song song theo lô. */
  async function collectChapters($first, slug) {
    const readPage = ($) => {
      const out = [];
      $(SEL.chapterList).each((_, a) => {
        const href = $(a).attr('href');
        if (!href) return;
        const { name, title } = parseChapterName($(a).attr('title') || $(a).text());
        out.push({ name, title, apiUrl: abs(base, href) });
      });
      return out;
    };

    const chapters = readPage($first);
    const totalPage = Math.max(1, parseInt($first(SEL.totalPage).attr('value') || '1', 10) || 1);

    for (let p = 2; p <= totalPage; p += listConcurrency) {
      const batch = [];
      for (let q = p; q < Math.min(p + listConcurrency, totalPage + 1); q++) {
        batch.push(
          fetchText(`${base}/${slug}/trang-${q}/`, { polite: false })
            .then(html => readPage(cheerio.load(html)))
            .catch(() => []),
        );
      }
      for (const part of await Promise.all(batch)) chapters.push(...part);
    }

    // Khử trùng theo tên chương (mục lục đôi khi lặp ở ranh giới trang), rồi đánh số.
    const uniq = [];
    const seen = new Set();
    for (const c of chapters) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      uniq.push(c);
    }
    uniq.forEach((c, i) => { c.order = i; });
    return uniq;
  }

  return {
    id: 'truyenfull',
    label: 'Truyện chữ',
    kind: 'novel',

    setBase(nb) { if (nb) base = nb.replace(/\/+$/, ''); },
    getBase() { return base; },

    async home() {
      return { items: (await listPage('/danh-sach/truyen-moi/', 1)).items, pagination: null };
    },

    async list(type = 'truyen-moi', page = 1) {
      return listPage(`/danh-sach/${type}/`, page);
    },

    async byCategory(slug, page = 1) {
      return listPage(`/the-loai/${slug}/`, page);
    },

    async categories() {
      const $ = await load(`${base}/`);
      const seen = new Map();
      $('a[href*="/the-loai/"]').each((_, a) => {
        const href = String($(a).attr('href') || '');
        const m = href.match(/\/the-loai\/([a-z0-9-]+)\/?$/i);
        const name = $(a).text().trim();
        if (m && name && !seen.has(m[1])) seen.set(m[1], { name, slug: m[1] });
      });
      return [...seen.values()];
    },

    async search(keyword) {
      const $ = await load(`${base}/tim-kiem/?tukhoa=${encodeURIComponent(keyword)}`);
      return { items: parseRows($), pagination: null };
    },

    async detail(slug) {
      const $ = await load(`${base}/${slug}/`);
      const infoText = $(SEL.info).map((_, d) => $(d).text().replace(/\s+/g, ' ').trim()).get();
      const statusLine = infoText.find(t => /tr[aạ]ng th[aá]i/i.test(t)) || '';
      const authorText = $(SEL.author).first().text().trim();

      const chapters = await collectChapters($, slug);

      // Thể loại lặp nhiều lần trong microdata -> khử trùng, giữ thứ tự.
      const cats = [];
      const seenCat = new Set();
      $(SEL.genre).each((_, a) => {
        const n = $(a).text().trim();
        if (n && !seenCat.has(n)) { seenCat.add(n); cats.push(n); }
      });

      return {
        kind: 'novel',
        slug,
        name: scrubBrands($(SEL.title).first().text().trim()),
        origin: '',
        content: cleanSynopsis($(SEL.synopsis).first().html() || ''),
        status: /full|ho[àa]n/i.test(statusLine) ? 'completed' : 'ongoing',
        thumbUrl: abs(base, $(SEL.cover).attr('src') || $(SEL.cover).attr('content') || ''),
        categories: cats,
        author: /đang cập nhật/i.test(authorText) ? '' : scrubBrands(authorText),
        updatedAt: null,
        chapters,
      };
    },

    /** chapterUrl là URL trang đọc chương (lấy từ detail.chapters[].apiUrl). */
    async chapter(chapterUrl) {
      const $ = await load(chapterUrl);
      const $c = $(SEL.content).first();
      // Bỏ quảng cáo/script trước khi lấy nội dung
      $c.find('script, style, ins, iframe, .ads, [class*="ads"], [id*="ads"], div[align="center"]').remove();
      const html = ($c.html() || '')
        .replace(/<br\s*\/?>(\s*<br\s*\/?>)*/gi, '\n')   // gộp mọi cụm <br> thành 1 ngắt đoạn
        .replace(/<\/p>/gi, '\n');
      const text = cheerio.load(`<div>${html}</div>`)('div').text();
      const paragraphs = text.split('\n').map(s => s.trim()).filter(Boolean);
      return {
        title: $(SEL.chapterTitle).first().text().trim(),
        paragraphs,
      };
    },
  };
}
