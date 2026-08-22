import { api } from './common.js';

const stage = document.querySelector('.rdstage');
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

const MODE = localStorage.getItem('rd-mode') === 'paged' ? 'paged' : 'scroll';

/* ---------- Tải một trang: đo tỉ lệ thật, đặt aspect-ratio đúng trước khi hiện ---------- */
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

/* ---------- Lưu tiến độ (theo chỉ số trang) ---------- */
let saveTimer;
function saveProgress(idx) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/progress', { method: 'POST', body: JSON.stringify({ slug, chapter, page: idx }) }).catch(() => {});
  }, 500);
}

/* ---------- Tải trước chương kế tiếp (làm ấm cache + vài ảnh đầu) ---------- */
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

/* ---------- Đổi chế độ đọc (cuộn <-> lật): lưu rồi tải lại cho gọn ---------- */
const modeBtn = document.getElementById('modeBtn');
if (modeBtn) {
  modeBtn.textContent = MODE === 'paged' ? '⇅ Cuộn' : '⇄ Lật';
  modeBtn.addEventListener('click', () => {
    localStorage.setItem('rd-mode', MODE === 'paged' ? 'scroll' : 'paged');
    location.reload();
  });
}

/* nút prev/next chương (dùng chung) */
const goNextChap = () => document.querySelector('.rnav .pri')?.closest('a')?.click();
const goPrevChap = () => document.querySelector('.rnav a:has(button:not(.pri))')?.click();

/* ============================ CHẾ ĐỘ CUỘN DỌC ============================ */
function initScroll() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const idx = imgs.indexOf(e.target);
      for (let i = idx; i < Math.min(imgs.length, idx + 6); i++) loadImg(imgs[i]);
      io.unobserve(e.target);
    }
  }, { rootMargin: '1600px 0px' });
  imgs.forEach(im => io.observe(im));

  (async function warmAll() {                       // nạp nền cả chương, 4 ảnh/lượt
    let i = 0;
    const worker = async () => { while (i < imgs.length) await loadImg(imgs[i++]); };
    await new Promise(r => setTimeout(r, 400));
    await Promise.all(Array.from({ length: 4 }, worker));
  })();

  if (startPage > 0 && mpages[startPage]) mpages[startPage].scrollIntoView();

  const maxY = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
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
    saveProgress(cur);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Tự cuộn
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') goNextChap();
    if (e.key === 'ArrowLeft') goPrevChap();
    if (e.key === ' ') { e.preventDefault(); autoOn ? stopAuto() : startAuto(); }
    if (e.key === '+' || e.key === '=') { speed = Math.min(9, speed + 1); localStorage.setItem('rd-auto-speed', speed); }
    if (e.key === '-') { speed = Math.max(1, speed - 1); localStorage.setItem('rd-auto-speed', speed); }
  });
}

/* ============================ CHẾ ĐỘ LẬT TRANG ============================ */
function initPaged() {
  stage.classList.add('paged');
  document.getElementById('autoBtn')?.remove();     // tự cuộn không dùng ở chế độ lật
  let cur = Math.min(Math.max(0, startPage), total - 1);

  function show(i) {
    cur = Math.min(Math.max(0, i), total - 1);
    mpages.forEach((m, k) => m.classList.toggle('cur', k === cur));
    loadImg(imgs[cur]); loadImg(imgs[cur + 1]); loadImg(imgs[cur - 1] || null);
    window.scrollTo(0, 0);
    if (track) track.style.width = ((cur + 1) / total * 100) + '%';
    if (pageLabel) pageLabel.innerHTML = `Trang ${cur + 1} <s>/ ${total}</s>`;
    if (cur + 1 >= total * 0.5) prefetchNext();
    saveProgress(cur);
  }
  const next = () => (cur >= total - 1 ? goNextChap() : show(cur + 1));
  const prev = () => (cur <= 0 ? goPrevChap() : show(cur - 1));

  // Chạm: mép trái = trang trước, mép phải = trang sau, giữa = ẩn/hiện thanh
  stage.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) return;      // để nút hoạt động bình thường
    const x = e.clientX / window.innerWidth;
    if (x < 0.33) prev();
    else if (x > 0.67) next();
    else document.body.classList.toggle('imm');       // immersive: ẩn thanh trên/dưới
  });

  // Vuốt trái/phải
  let sx = 0, sy = 0;
  stage.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next() : prev());
  }, { passive: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); prev(); }
  });

  show(cur);
}

/* ---------- Fullscreen (chung) ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'f' || e.key === 'F') {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
});

if (MODE === 'paged') initPaged(); else initScroll();
