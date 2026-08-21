import { api } from './common.js';

const pages = document.getElementById('pages');
const slug = pages.dataset.slug;
const chapter = pages.dataset.chapter;
const startPage = Number(pages.dataset.start || 0);
const imgs = [...pages.querySelectorAll('.mpage img')];
const track = document.getElementById('track');
const pageLabel = document.getElementById('pageLabel');
const total = imgs.length;

// lazy-load + prefetch next 3 using IntersectionObserver
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const idx = imgs.indexOf(e.target);
    for (let i = idx; i < Math.min(imgs.length, idx + 6); i++) {
      const im = imgs[i];
      if (im.dataset.src) { im.src = im.dataset.src; delete im.dataset.src; }
    }
    io.unobserve(e.target);
  }
}, { rootMargin: '1600px 0px' });
imgs.forEach(im => io.observe(im));

// #1 Tải trước CẢ chương ở nền (giới hạn 4 ảnh cùng lúc): đọc trang đầu thì các
// trang sau đã ngầm tải xong, cuộn tới đâu ảnh có sẵn tới đó. Ưu tiên viewport
// trước (IntersectionObserver), nên bắt đầu sau một nhịp ngắn.
async function warmAllImages() {
  const CONC = 4;
  let i = 0;
  async function worker() {
    while (i < imgs.length) {
      const im = imgs[i++];
      if (!im.dataset.src) continue;                 // đã tải bởi IO ở trên
      im.src = im.dataset.src; delete im.dataset.src;
      await new Promise(r => {
        im.addEventListener('load', r, { once: true });
        im.addEventListener('error', r, { once: true });
      });
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
}
setTimeout(warmAllImages, 500);

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

// Do ti le tu vai trang dau roi ap cho nhung trang chua tai (bien --pg-ar trong CSS),
// de luc anh tai xong o chua no khong doi kich thuoc -> het rung khi dang cuon.
const ratios = [];
function markLoaded(im) {
  im.dataset.ok = '1';
  if (ratios.length < 3 && im.naturalWidth && im.naturalHeight) {
    ratios.push(im.naturalWidth / im.naturalHeight);
    const sorted = [...ratios].sort((a, b) => a - b);
    pages.style.setProperty('--pg-ar', String(sorted[Math.floor(sorted.length / 2)]));
  }
}
imgs.forEach(im => {
  if (im.complete && im.naturalWidth) markLoaded(im);
  else im.addEventListener('load', () => markLoaded(im), { once: true });
});

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

// keyboard: left/right = prev/next chapter, f = fullscreen
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') document.querySelector('.rnav .pri')?.closest('a')?.click();
  if (e.key === 'ArrowLeft') document.querySelector('.rnav button:not(.pri)')?.closest('a')?.click();
  if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
});
