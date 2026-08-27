import { api } from './common.js';

const col = document.getElementById('novel');
const stage = document.querySelector('.rdstage.novel');
const slug = col.dataset.slug;
const chapter = col.dataset.chapter;
const startPercent = Number(col.dataset.start || 0);
const track = document.getElementById('track');
const posLabel = document.getElementById('posLabel');
const paras = [...col.querySelectorAll('p')];

/* ==================== Tuỳ chỉnh (nhớ trong localStorage) ==================== */
const store = {
  get(k, d) { const v = localStorage.getItem('nv-' + k); return v === null ? d : v; },
  set(k, v) { localStorage.setItem('nv-' + k, String(v)); },
};

const FF = { sans: "var(--font-prose)", serif: "Georgia, 'Times New Roman', 'Times', serif" };
let theme = store.get('theme', 'paper');
let ff = store.get('ff', 'sans');
let fontPx = Math.min(30, Math.max(15, Number(store.get('font', 19))));
let lineH = Math.min(2.4, Math.max(1.4, Number(store.get('lh', 1.85))));
let scrollSpeed = Math.min(8, Math.max(1, Number(store.get('sp', 2))));   // px/frame
let ttsRate = Math.min(2, Math.max(0.5, Number(store.get('tts', 1))));

function applyAll() {
  if (stage) stage.dataset.th = theme;
  col.style.setProperty('--novel-ff', FF[ff] || FF.sans);
  col.style.setProperty('--novel-fs', fontPx + 'px');
  col.style.setProperty('--novel-lh', String(lineH));
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('fVal', fontPx); set('lhVal', lineH.toFixed(2)); set('spVal', scrollSpeed); set('ttsVal', ttsRate.toFixed(1));
  // đánh dấu nút đang chọn
  document.querySelectorAll('[data-group="theme"] button').forEach(b => b.classList.toggle('on', b.dataset.th === theme));
  document.querySelectorAll('[data-group="ff"] button').forEach(b => b.classList.toggle('on', b.dataset.ff === ff));
}
applyAll();

/* Panel mở/đóng */
/* Bảng tuỳ chỉnh = drawer nổi: mở/đóng bằng ⚙, chạm nền mờ, nút ✕, phím Esc. */
const cfgPanel = document.getElementById('nvcfg');
const cfgBack = document.getElementById('nvcfgBack');
function openCfg() { if (cfgPanel) cfgPanel.hidden = false; if (cfgBack) cfgBack.hidden = false; showChrome(); }
function closeCfg() { if (cfgPanel) cfgPanel.hidden = true; if (cfgBack) cfgBack.hidden = true; }
document.getElementById('cfgBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  cfgPanel && cfgPanel.hidden ? openCfg() : closeCfg();
});
document.getElementById('cfgClose')?.addEventListener('click', closeCfg);
cfgBack?.addEventListener('click', closeCfg);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cfgPanel && !cfgPanel.hidden) closeCfg(); });

document.querySelectorAll('[data-group="theme"] button').forEach(b =>
  b.addEventListener('click', () => { theme = b.dataset.th; store.set('theme', theme); applyAll(); }));
document.querySelectorAll('[data-group="ff"] button').forEach(b =>
  b.addEventListener('click', () => { ff = b.dataset.ff; store.set('ff', ff); applyAll(); }));
const bind = (id, fn) => document.getElementById(id)?.addEventListener('click', () => { fn(); applyAll(); });
bind('fPlus', () => { fontPx = Math.min(30, fontPx + 1); store.set('font', fontPx); });
bind('fMinus', () => { fontPx = Math.max(15, fontPx - 1); store.set('font', fontPx); });
bind('lhPlus', () => { lineH = Math.min(2.4, +(lineH + 0.1).toFixed(2)); store.set('lh', lineH); });
bind('lhMinus', () => { lineH = Math.max(1.4, +(lineH - 0.1).toFixed(2)); store.set('lh', lineH); });
bind('spPlus', () => { scrollSpeed = Math.min(8, scrollSpeed + 1); store.set('sp', scrollSpeed); });
bind('spMinus', () => { scrollSpeed = Math.max(1, scrollSpeed - 1); store.set('sp', scrollSpeed); });
bind('ttsPlus', () => { ttsRate = Math.min(2, +(ttsRate + 0.1).toFixed(1)); store.set('tts', ttsRate); if (speaking) restartTTS(); });
bind('ttsMinus', () => { ttsRate = Math.max(0.5, +(ttsRate - 0.1).toFixed(1)); store.set('tts', ttsRate); if (speaking) restartTTS(); });

/* ==================== Vị trí cuộn: khôi phục + lưu theo % ==================== */
const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
if (startPercent > 0) requestAnimationFrame(() => window.scrollTo(0, Math.round(maxScroll() * startPercent / 100)));

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

/* Tự ẩn thanh trên/dưới khi đang đọc (cuộn xuống); hiện lại khi cuộn lên hoặc
   chạm giữa trang. Nhường trọn màn cho chữ. */
const showChrome = () => document.body.classList.remove('chrome-hide');
let chromeY = window.scrollY;
window.addEventListener('scroll', () => {
  const y = window.scrollY;
  if (y > chromeY + 8 && y > 140) document.body.classList.add('chrome-hide');
  else if (y < chromeY - 8) showChrome();
  chromeY = y;
}, { passive: true });
// Chạm vào vùng chữ (không phải nút/link/panel) -> bật tắt thanh.
document.addEventListener('click', (e) => {
  if (e.target.closest('a, button, .nvcfg, .nvcfg-back, .rdbar, .rdfoot')) return;
  document.body.classList.toggle('chrome-hide');
});

/* ==================== #3 Tự cuộn ==================== */
const autoBtn = document.getElementById('autoBtn');
let autoOn = false, autoRAF = 0, acc = 0;
function autoStep() {
  if (!autoOn) return;
  acc += scrollSpeed;
  const dy = Math.floor(acc); acc -= dy;
  window.scrollBy(0, dy);
  if (window.scrollY >= maxScroll() - 1) { stopAuto(); return; }   // hết chương thì dừng
  autoRAF = requestAnimationFrame(autoStep);
}
function startAuto() {
  stopTTS();
  autoOn = true; if (autoBtn) autoBtn.textContent = '⏸';
  cancelAnimationFrame(autoRAF); autoRAF = requestAnimationFrame(autoStep);
}
function stopAuto() {
  autoOn = false; if (autoBtn) autoBtn.textContent = '▶';
  cancelAnimationFrame(autoRAF);
}
autoBtn?.addEventListener('click', () => (autoOn ? stopAuto() : startAuto()));
// Người dùng tự cuộn ngược lên thì tắt auto (tránh giằng co)
let lastY = window.scrollY;
window.addEventListener('scroll', () => {
  if (autoOn && window.scrollY < lastY - 4) stopAuto();
  lastY = window.scrollY;
}, { passive: true });

/* ==================== #1 Nghe truyện (TTS) ==================== */
const ttsBtn = document.getElementById('ttsBtn');
const synth = window.speechSynthesis;
let speaking = false, curIdx = 0, viVoice = null;

function pickVoice() {
  const vs = synth ? synth.getVoices() : [];
  viVoice = vs.find(v => /vi(-|_)?VN/i.test(v.lang)) || vs.find(v => /^vi/i.test(v.lang)) || null;
}
if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }

function speakFrom(idx) {
  if (!synth || idx >= paras.length) { stopTTS(); return; }
  curIdx = idx;
  paras.forEach((p, i) => p.classList.toggle('tts-cur', i === idx));
  paras[idx].scrollIntoView({ block: 'center', behavior: 'smooth' });
  const u = new SpeechSynthesisUtterance(paras[idx].textContent);
  u.lang = 'vi-VN'; u.rate = ttsRate; if (viVoice) u.voice = viVoice;
  u.onend = () => { if (speaking) speakFrom(idx + 1); };
  synth.speak(u);
}
function startTTS() {
  if (!synth) { alert('Trình duyệt không hỗ trợ đọc to.'); return; }
  stopAuto();
  speaking = true; if (ttsBtn) ttsBtn.textContent = '⏹';
  // bắt đầu từ đoạn gần giữa màn hình
  const mid = window.innerHeight / 2;
  let start = paras.findIndex(p => p.getBoundingClientRect().bottom > mid);
  speakFrom(start < 0 ? 0 : start);
}
function stopTTS() {
  speaking = false; if (ttsBtn) ttsBtn.textContent = '🔊';
  paras.forEach(p => p.classList.remove('tts-cur'));
  if (synth) synth.cancel();
}
function restartTTS() { if (synth) synth.cancel(); if (speaking) speakFrom(curIdx); }
ttsBtn?.addEventListener('click', () => (speaking ? stopTTS() : startTTS()));
window.addEventListener('beforeunload', stopTTS);

/* ==================== Phím ==================== */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'ArrowRight') document.querySelector('.rnav .pri')?.closest('a')?.click();
  if (e.key === 'ArrowLeft') document.querySelector('.rnav a:has(button:not(.pri))')?.click();
  if (e.key === ' ') { e.preventDefault(); autoOn ? stopAuto() : startAuto(); }   // Space = tự cuộn
});
