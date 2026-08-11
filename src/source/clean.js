/**
 * Dọn phần giới thiệu truyện: nguồn thường nhét câu quảng bá trang web
 * ("... cập nhật nhanh nhất tại TruyenQQ, đừng quên bình luận và chia sẻ ...").
 * Web này không quảng cáo, nên bỏ hẳn những câu đó.
 */

// Câu mang tính quảng bá / kêu gọi tương tác của trang nguồn
const PROMO = [
  /truyenqq/i,
  /nettruyen/i,
  /otruyen/i,
  /truyen\s?vua/i,
  /được cập nhật (nhanh|sớm|đầy đủ)/i,
  /cập nhật (nhanh|sớm) (và|nhất)/i,
  /đừng quên (để lại )?(bình luận|comment)/i,
  /(ủng hộ|theo dõi) (nhóm dịch|fanpage|page|website|web|nhóm)/i,
  /(chia sẻ|share) (truyện|website|web|bài)/i,
  /(đọc|xem) truyện (tranh )?(online|tại)/i,
  /bản quyền thuộc/i,
  /\bwebsite\b/i,
  /\.com\b|\.net\b|\.vn\b/i,
];

const isPromo = (s) => PROMO.some(re => re.test(s));

const stripTags = (html) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>');

/**
 * @returns {string} văn bản thuần đã bỏ câu quảng cáo; '' nếu không còn gì đáng đọc
 */
export function cleanSynopsis(html) {
  const text = stripTags(html);
  const kept = text
    .split(/\n+/)
    .flatMap(block => block.split(/(?<=[.!?…])\s+/))   // tách theo câu
    .map(s => s.trim())
    .filter(s => s && !isPromo(s));

  const out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  // còn quá ngắn thì coi như không có giới thiệu
  return out.length < 40 ? '' : out;
}
