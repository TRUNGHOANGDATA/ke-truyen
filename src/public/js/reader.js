import { api } from './common.js';

const pages = document.getElementById('pages');
const slug = pages.dataset.slug;
const chapter = pages.dataset.chapter;
const startPage = Number(pages.dataset.start || 0);
const imgs = [...pages.querySelectorAll('.mpage img')];
const track = document.getElementById('track');
const pageLabel = document.getElementById('pageLabel');
const total = imgs.length;

// Tải một trang: ĐO tỉ lệ thật bằng bộ nạp rời, đặt aspect-ratio ĐÚNG cho ô chứa
// TRƯỚC khi ảnh hiện -> ô không đổi kích thước lúc ảnh tải xong -> hết rung, kể
// cả trên điện thoại và khi các trang có khổ khác nhau. Trả Promise để nạp nền
// giới hạn số ảnh cùng lúc.
function loadImg(im) {
  const src = im.dataset.src;
  if (!src) return Promise.resolve();          // đã (đang) tải
  delete im.dataset.src;
  const mpage = im.closest('.mpage');
  return new Promise(res => {
    const pre = new Image();
    const show = () => { im.src = src; im.dataset.ok = '1'; res(); };
    pre.onload = () => {
      if (pre.naturalWidth && pre.naturalHeight) {
        mpage.style.aspectRatio = pre.naturalWidth + ' / ' + pre.naturalHeight;
      }
      show();                                   // src đã trong cache -> hiện tức thì vào ô đúng cỡ
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

// #1 Tải trước CẢ chương ở nền (4 ảnh cùng lúc, top-down): trang trên nạp trước
// nên cuộn xuống ảnh đã có sẵn, ô đã đúng cỡ -> không giật.
async function warmAllImages() {
  const CONC = 4;
  let i = 0;
  const worker = async () => { while (i < imgs.length) await loadImg(imgs[i++]); };
  await Promise.all(Array.from({ length: CONC }, worker));
}
setTimeout(warmAllImages, 400);

// #2 Tải trước chương kế tiếp: xin danh sách ảnh (đồng thời làm ấm cache server),
// nạp sẵn vài ảnh đầu. Chạy một lần khi đã cuộn quá nửa chương.
const nextChap = pages.dataset.next || '';
let prefetchedNext = false;
async function prefetchNext() {
  if (prefetchedNext || !nextChap) return;
  prefetchedNext = true;
  try {
    const { images = [] } = await api(
      `/api/chapter-images?slug=${encodeURIComponent(slug)}&chapter=${encodeURIComponent(nextChap)}`);
    images.slice(0, 5).forEach(u => { const im = new Image(); im.src = u; });
  } catch { /* bỏ qua nếu lỗi */ }
}

// jump to saved page
if (startPage > 0 && imgs[startPage]) {
  imgs[startPage].closest('.mpage').scrollIntoView();
}

let saveTimer;
function currentPage() {
  const mid = window.innerHeight / 2;
  let cur = 0;
  document.querySelectorAll('.mpage').forEach((m, i) => {
    if (m.getBoundingClientRect().top < mid) cur = i;
  });
  return Math.min(cur, total - 1);
}
function onScroll() {
  const cur = currentPage();
  if (track) track.style.width = ((cur + 1) / total * 100) + '%';
  if (pageLabel) pageLabel.innerHTML = `Trang ${cur + 1} <s>/ ${total}</s>`;
  if (cur + 1 >= total * 0.5) prefetchNext();   // quá nửa chương -> nạp trước chương sau
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/progress', { method: 'POST', body: JSON.stringify({ slug, chapter, page: cur }) }).catch(() => {});
  }, 700);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Tự cuộn (nhớ tốc độ trong localStorage). Cuộn ngược lên tay -> tự tắt.
const autoBtn = document.getElementById('autoBtn');
const maxY = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
let speed = Math.min(9, Math.max(1, Number(localStorage.getItem('rd-auto-speed')) || 3));
let autoOn = false, autoRAF = 0, acc = 0, lastY = window.scrollY;
function autoStep() {
  if (!autoOn) return;
  acc += speed; const dy = Math.floor(acc); acc -= dy;
  window.scrollBy(0, dy);
  if (window.scrollY >= maxY() - 1) return stopAuto();   // hết chương thì dừng
  autoRAF = requestAnimationFrame(autoStep);
}
function startAuto() { autoOn = true; if (autoBtn) autoBtn.textContent = '⏸'; cancelAnimationFrame(autoRAF); autoRAF = requestAnimationFrame(autoStep); }
function stopAuto() { autoOn = false; if (autoBtn) autoBtn.textContent = '▶'; cancelAnimationFrame(autoRAF); }
autoBtn?.addEventListener('click', () => (autoOn ? stopAuto() : startAuto()));
window.addEventListener('scroll', () => {
  if (autoOn && window.scrollY < lastY - 4) stopAuto();   // cuộn ngược lên -> tắt
  lastY = window.scrollY;
}, { passive: true });

// keyboard: left/right = prev/next chapter, f = fullscreen, space = tự cuộn,
// +/- = tăng/giảm tốc độ tự cuộn
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') document.querySelector('.rnav .pri')?.closest('a')?.click();
  if (e.key === 'ArrowLeft') document.querySelector('.rnav button:not(.pri)')?.closest('a')?.click();
  if (e.key === ' ') { e.preventDefault(); autoOn ? stopAuto() : startAuto(); }
  if (e.key === '+' || e.key === '=') { speed = Math.min(9, speed + 1); localStorage.setItem('rd-auto-speed', speed); }
  if (e.key === '-') { speed = Math.max(1, speed - 1); localStorage.setItem('rd-auto-speed', speed); }
  if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
});
