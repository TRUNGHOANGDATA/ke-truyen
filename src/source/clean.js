/**
 * Dọn phần giới thiệu truyện: nguồn thường nhét câu quảng bá trang web
 * ("... cập nhật nhanh nhất tại TruyenQQ, đừng quên bình luận và chia sẻ ...").
 * Web này không quảng cáo, nên bỏ hẳn những câu đó.
 */

/** Tên các trang nguồn — loại khỏi mọi chữ hiển thị trên web */
const BRANDS = /truyenqq[a-z]*|nettruyen[a-z]*|otruyen[a-z]*|truyen\s?vua|hinhhinh|tintruyen|truyentranh8|mangaraw/gi;

/** Bỏ tên nguồn khỏi một đoạn chữ rồi dọn khoảng trắng/dấu câu lẻ */
export function scrubBrands(text) {
  return String(text || '')
    .replace(BRANDS, '')
    .replace(/\s*[·|–-]\s*$/g, '')
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

// Câu mang tính quảng bá / SEO / kêu gọi tương tác của trang nguồn
const PROMO = [
  BRANDS,
  /được cập nhật (nhanh|sớm|đầy đủ)/i,
  /cập nhật (nhanh|sớm) (và|nhất)/i,
  /đừng quên (để lại )?(bình luận|comment)/i,
  /(ủng hộ|theo dõi) (nhóm dịch|fanpage|page|website|web|nhóm)/i,
  /(chia sẻ|share) (truyện|website|web|bài)/i,
  /(đọc|xem) truyện (tranh )?(online|tại)/i,
  /bản quyền thuộc/i,
  /\bwebsite\b/i,
  /\.com\b|\.net\b|\.vn\b/i,

  // Đoạn SEO tự sinh: "X là một trong những tác phẩm nổi bật thuộc nhóm thể loại Y,
  // được chấp bút bởi Z ... đã ghi nhận hơn N lượt xem ... Theo dõi X trên ... "
  /là một trong những (tác phẩm|bộ truyện)/i,
  /nhóm thể loại/i,
  /được chấp bút bởi/i,
  /mang đến cho độc giả/i,
  /bản (dịch|chuyển ngữ) (của|từ)/i,
  /giữ được tinh thần nguyên tác/i,
  /ghi nhận (hơn )?[\d.,]+ lượt xem/i,
  /lựa chọn quen thuộc/i,
  /cộng đồng (yêu thích|độc giả)/i,
  /hiện đã phát hành đến/i,
  /cho phép người đọc/i,
  /ghi điểm nhờ/i,
  /trải nghiệm đọc/i,
  /phù hợp với độc giả/i,
  /tạo nên sức hút/i,
  /để cập nhật chương mới/i,
  /diễn biến hấp dẫn/i,
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

  const out = scrubBrands(kept.join(' ').replace(/\s{2,}/g, ' ').trim());
  // còn quá ngắn thì coi như không có giới thiệu
  return out.length < 40 ? '' : out;
}
