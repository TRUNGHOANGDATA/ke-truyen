import { api } from './common.js';

const pages = document.getElementById('pages');
const slug = pages.dataset.slug;
const chapter = pages.dataset.chapter;
const startPage = Number(pages.dataset.start || 0);
const nextChap = pages.dataset.next || '';
const imgs = [...pages.querySelectorAll('.mpage img')];
const mpages = imgs.map(im => im.closest('.mpage'));
const track = document.getElementById('track');
const pageLabel = document.getElementById('pageLabel');
const total = imgs.length;

// Tải một trang: ĐO tỉ lệ thật bằng bộ nạp rời, đặt aspect-ratio ĐÚNG cho ô chứa
// TRƯỚC khi ảnh hiện -> ô không đổi kích thước lúc ảnh tải xong -> hết rung.
function loadImg(im) {
  if (!im || !im.dataset.src) return Promise.resolve();
  const src = im.dataset.src; delete im.dataset.src;
  const mpage = im.closest('.mpage');
  return new Promise(res => {
    const pre = new Image();
    const show = () => { im.src = src; im.dataset.ok = '1'; res(); };
    pre.onload = () => {
      if (pre.naturalWidth && pre.naturalHeight) mpage.style.aspectRatio = pre.naturalWidth + ' / ' + pre.naturalHeight;
      show();
    };
    pre.onerror = show;
    pre.src = src;
  });
}

// Ưu tiên vùng nhìn: nạp trang vào tầm nhìn + vài trang kế tiếp.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const idx = imgs.indexOf(e.target);
    for (let i = idx; i < Math.min(imgs.length, idx + 6); i++) loadImg(imgs[i]);
    io.unobserve(e.target);
  }
}, { rootMargin: '1600px 0px' });
imgs.forEach(im => io.observe(im));

// Tải trước CẢ chương ở nền (4 ảnh cùng lúc, top-down).
(async function warmAll() {
  let i = 0;
  const worker = async () => { while (i < imgs.length) await loadImg(imgs[i++]); };
  await new Promise(r => setTimeout(r, 400));
  await Promise.all(Array.from({ length: 4 }, worker));
})();

// Tải trước chương kế tiếp: xin danh sách ảnh (làm ấm cache) + nạp vài ảnh đầu.
let prefetchedNext = false;
async function prefetchNext() {
  if (prefetchedNext || !nextChap) return;
  prefetchedNext = true;
  try {
    const { images = [] } = await api(
      `/api/chapter-images?slug=${encodeURIComponent(slug)}&chapter=${encodeURIComponent(nextChap)}`);
    images.slice(0, 5).forEach(u => { const im = new Image(); im.src = u; });
  } catch { /* bỏ qua */ }
}

// Nhảy tới trang đang đọc dở
if (startPage > 0 && mpages[startPage]) mpages[startPage].scrollIntoView();

const maxY = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
let saveTimer;
function currentPage() {
  const mid = window.innerHeight / 2;
  let cur = 0;
  mpages.forEach((m, i) => { if (m.getBoundingClientRect().top < mid) cur = i; });
  return Math.min(cur, total - 1);
}
function onScroll() {
  const cur = currentPage();
  if (track) track.style.width = ((cur + 1) / total * 100) + '%';
  if (pageLabel) pageLabel.innerHTML = `Trang ${cur + 1} <s>/ ${total}</s>`;
  if (cur + 1 >= total * 0.5) prefetchNext();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/progress', { method: 'POST', body: JSON.stringify({ slug, chapter, page: cur }) }).catch(() => {});
  }, 700);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Tự cuộn (nhớ tốc độ trong localStorage). Cuộn ngược lên tay -> tự tắt.
const autoBtn = document.getElementById('autoBtn');
let speed = Math.min(9, Math.max(1, Number(localStorage.getItem('rd-auto-speed')) || 3));
let autoOn = false, autoRAF = 0, acc = 0, lastY = window.scrollY;
function autoStep() {
  if (!autoOn) return;
  acc += speed; const dy = Math.floor(acc); acc -= dy;
  window.scrollBy(0, dy);
  if (window.scrollY >= maxY() - 1) return stopAuto();
  autoRAF = requestAnimationFrame(autoStep);
}
function startAuto() { autoOn = true; if (autoBtn) autoBtn.textContent = '⏸'; cancelAnimationFrame(autoRAF); autoRAF = requestAnimationFrame(autoStep); }
function stopAuto() { autoOn = false; if (autoBtn) autoBtn.textContent = '▶'; cancelAnimationFrame(autoRAF); }
autoBtn?.addEventListener('click', () => (autoOn ? stopAuto() : startAuto()));
window.addEventListener('scroll', () => { if (autoOn && window.scrollY < lastY - 4) stopAuto(); lastY = window.scrollY; }, { passive: true });

// Phím: trái/phải = chương trước/sau, f = toàn màn hình, space = tự cuộn, +/- tốc độ
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') document.querySelector('.rnav .pri')?.closest('a')?.click();
  if (e.key === 'ArrowLeft') document.querySelector('.rnav a:has(button:not(.pri))')?.click();
  if (e.key === ' ') { e.preventDefault(); autoOn ? stopAuto() : startAuto(); }
  if (e.key === '+' || e.key === '=') { speed = Math.min(9, speed + 1); localStorage.setItem('rd-auto-speed', speed); }
  if (e.key === '-') { speed = Math.max(1, speed - 1); localStorage.setItem('rd-auto-speed', speed); }
  if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
});
