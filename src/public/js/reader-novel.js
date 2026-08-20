import { api } from './common.js';

const col = document.getElementById('novel');
const slug = col.dataset.slug;
const chapter = col.dataset.chapter;
const startPercent = Number(col.dataset.start || 0);
const track = document.getElementById('track');
const posLabel = document.getElementById('posLabel');

/* ---------- Cỡ chữ (nhớ trong localStorage) ---------- */
const FONT_KEY = 'novel-font';
const MIN = 15, MAX = 30, DEF = 19;
let fontPx = Math.min(MAX, Math.max(MIN, Number(localStorage.getItem(FONT_KEY)) || DEF));
function applyFont() {
  col.style.setProperty('--novel-fs', fontPx + 'px');
  localStorage.setItem(FONT_KEY, String(fontPx));
}
applyFont();
document.getElementById('fontPlus')?.addEventListener('click', () => { fontPx = Math.min(MAX, fontPx + 1); applyFont(); });
document.getElementById('fontMinus')?.addEventListener('click', () => { fontPx = Math.max(MIN, fontPx - 1); applyFont(); });

/* ---------- Vị trí cuộn: khôi phục + lưu theo % ---------- */
function maxScroll() {
  return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
}

// Khôi phục vị trí đọc dở (sau khi ảnh/layout ổn định)
if (startPercent > 0) {
  requestAnimationFrame(() => window.scrollTo(0, Math.round(maxScroll() * startPercent / 100)));
}

let saveTimer;
function onScroll() {
  const pct = Math.min(100, Math.max(0, Math.round(window.scrollY / maxScroll() * 100)));
  if (track) track.style.width = pct + '%';
  if (posLabel) posLabel.textContent = pct + '%';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/progress', { method: 'POST', body: JSON.stringify({ slug, chapter, page: pct }) }).catch(() => {});
  }, 700);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- Phím: trái/phải = chương trước/sau ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') document.querySelector('.rnav .pri')?.closest('a')?.click();
  if (e.key === 'ArrowLeft') document.querySelector('.rnav a:has(button:not(.pri))')?.click();
});
