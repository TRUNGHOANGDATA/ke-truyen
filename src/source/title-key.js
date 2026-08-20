/**
 * Khoá so tên truyện, dùng để nhận ra "cùng một bộ" giữa hai nguồn.
 * Bỏ dấu, hạ chữ, bỏ mọi ký tự không phải chữ/số — vì hai nguồn hay viết khác
 * nhau ở dấu câu và cách bỏ dấu ("Đại Đường: Vô Song" vs "Dai Duong Vo Song").
 */
export function titleKey(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // bỏ dấu thanh + dấu mũ
    .toLowerCase()
    .replace(/đ/g, 'd')                // NFD không tách đ/Đ nên phải xử riêng
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
