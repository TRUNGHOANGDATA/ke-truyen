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

/* ---------- Nạp ảnh: ưu tiên cái ĐANG NHÌN, nền phải nhường, lỗi tự thử lại ----------
   CDN nguồn chịu tải lẻ tốt nhưng dội song song là chặn (đo thật: 8 ảnh cùng lúc
   rớt 7). Nên: ảnh trong tầm nhìn đi làn nhanh; tải nền mang nhãn ?bg=1 để máy
   chủ xếp làn chậm, và tự dừng khi có ảnh tầm-nhìn đang chờ. */
let fgPending = 0;        // số ảnh tầm-nhìn đang tải -> tải nền nhìn vào đây mà nhường
let loadedCount = 0;

// Ảnh lỗi sau 3 lần thử: hiện ô bấm-để-thử-lại thay vì icon vỡ chết cứng.
function tileError(im, src) {
  const mpage = im.closest('.mpage');
  mpage.classList.add('perr');
  const tile = document.createElement('button');
  tile.type = 'button'; tile.className = 'perr-tile';
  tile.textContent = '⟳ Ảnh lỗi — bấm để thử lại';
  tile.addEventListener('click', () => {
    mpage.classList.remove('perr'); tile.remove();
    attempt(im, src, 0, false, null);
  });
  mpage.appendChild(tile);
}

// Một lượt tải: ĐO tỉ lệ thật bằng bộ nạp rời, đặt aspect-ratio ĐÚNG cho ô chứa
// TRƯỚC khi ảnh hiện -> ô không đổi kích thước lúc ảnh tải xong -> hết rung.
// Lỗi thì tự thử lại (1.2s rồi 3.5s) — 502/504 do CDN chặn nhất thời, thử lại là ăn.
function attempt(im, src, tryNo, bg, settle) {
  const mpage = im.closest('.mpage');
  if (!bg) fgPending++;
  const fin = () => {
    if (!bg) fgPending--;
    if (settle) { settle(); settle = null; }   // người xếp hàng chỉ chờ lượt đầu
  };
  const pre = new Image();
  pre.onload = () => {
    fin();
    if (pre.naturalWidth && pre.naturalHeight) mpage.style.aspectRatio = pre.naturalWidth + ' / ' + pre.naturalHeight;
    im.src = pre.src; im.dataset.ok = '1';
    mpage.classList.add('loaded');           // tắt skeleton, ảnh hiện dần
    loadedCount++;
    if (loadedCount >= total) prefetchNext();
  };
  pre.onerror = () => {
    fin();
    if (tryNo < 2) setTimeout(() => attempt(im, src, tryNo + 1, bg, null), tryNo === 0 ? 1200 : 3500);
    else tileError(im, src);
  };
  pre.src = src + (bg ? '&bg=1' : '');
}

function loadImg(im, { bg = false } = {}) {
  if (!im || !im.dataset.src) return Promise.resolve();
  const src = im.dataset.src; delete im.dataset.src;
  return new Promise(res => attempt(im, src, 0, bg, res));
}

// Ưu tiên vùng nhìn: ảnh vào tầm + 2 ảnh kế đi làn nhanh.
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const idx = imgs.indexOf(e.target);
    for (let i = idx; i < Math.min(imgs.length, idx + 3); i++) loadImg(imgs[i]);
    io.unobserve(e.target);
  }
}, { rootMargin: '1600px 0px' });
imgs.forEach(im => io.observe(im));

// Tải nền cả chương: 2 luồng, đi làn chậm, và DỪNG khi có ảnh tầm-nhìn đang chờ.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async function warmAll() {
  await sleep(1000);                       // nhường trọn đợt đầu cho ảnh trước mắt
  let i = 0;
  const worker = async () => {
    while (i < imgs.length) {
      while (fgPending > 0) await sleep(200);   // đang có ảnh trước mắt -> nhường
      await loadImg(imgs[i++], { bg: true });
    }
  };
  await Promise.all(Array.from({ length: 2 }, worker));
})();

// Tải trước chương kế tiếp: xin danh sách ảnh (làm ấm cache) + nạp vài ảnh đầu.
let prefetchedNext = false;
async function prefetchNext() {
  if (prefetchedNext || !nextChap) return;
  prefetchedNext = true;
  try {
    const { images = [] } = await api(
      `/api/chapter-images?slug=${encodeURIComponent(slug)}&chapter=${encodeURIComponent(nextChap)}`);
    // Chỉ vài ảnh đầu, đi làn nền — chương này còn chưa xong thì không giành đường.
    images.slice(0, 3).forEach(u => { const im = new Image(); im.src = u + '&bg=1'; });
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
  if (cur + 1 >= total) prefetchNext();     // đọc tới trang cuối thì chắc chắn ủ chương sau
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api('/api/progress', { method: 'POST', body: JSON.stringify({ slug, chapter, page: cur }) }).catch(() => {});
  }, 700);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* Tự ẩn thanh trên/dưới khi đang đọc (cuộn xuống); hiện lại khi cuộn lên hoặc
   chạm giữa trang. Nhường trọn màn cho ảnh. */
let chromeY = window.scrollY;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (y > chromeY + 8 && y > 140) document.body.classList.add('chrome-hide');
  else if (y < chromeY - 8) document.body.classList.remove('chrome-hide');
  chromeY = y;
}, { passive: true });
// Chạm vào ảnh/nền (không phải nút/link/menu nguồn) -> bật tắt thanh.
document.addEventListener('click', (e) => {
  if (e.target.closest('a, button, .srcpick, .rdbar, .rdfoot')) return;
  document.body.classList.toggle('chrome-hide');
});

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

/* ---------- Nút chọn nguồn, bày sẵn trên thanh đọc ----------
   Tra "bộ này có ở nguồn nào" ngay khi mở trang (không đợi bấm) rồi hiện nút,
   nên lúc ảnh lỗi là bấm đổi được liền. Máy chủ nhớ kết quả 12 tiếng nên các
   chương sau của cùng bộ hiện gần như tức thì. Chỉ hiện khi có TỪ 2 NGUỒN trở
   lên — một nguồn thì chẳng có gì để chọn.
   Máy chủ dựng sẵn được thì thôi (thường gặp): khỏi gọi lại, cũng khỏi chèn
   muộn làm nhảy thanh header. */
const srcPick = document.getElementById('srcPick');
if (srcPick && !srcPick.children.length) (async function loadSources() {
  const name = pages.dataset.name || '';
  if (!name) return;
  try {
    const q = `slug=${encodeURIComponent(slug)}&name=${encodeURIComponent(name)}&chapter=${encodeURIComponent(chapter)}`;
    const { sources = [] } = await api('/api/other-sources?' + q);
    if (!sources.length) return;
    // Chỉ 1 nguồn có bộ này thì nói thẳng, để biết là đã tra chứ không phải hỏng.
    srcPick.innerHTML = sources.length < 2
      ? '<span class="sp-none" title="Chỉ 1 nguồn có bộ này">'
        + '<i class="sp-full">Chỉ 1 nguồn có bộ này</i><i class="sp-short">1 nguồn</i></span>'
      : '<span class="sp-lb">Nguồn</span>' + sources.map(s => (s.current
        ? `<span class="sp-i on" title="${s.label} (đang đọc)" aria-current="true">${s.n}</span>`
        : `<a class="sp-i" href="${s.url}" title="Đọc từ ${s.label}">${s.n}</a>`)).join('');
    srcPick.hidden = false;
  } catch { /* không tra được thì thôi, không làm phiền lúc đang đọc */ }
})();
