import { api } from './common.js';

function cardHtml(c) {
  return `<a class="cc" href="/truyen/${c.slug}">
    <div class="thumb"><img loading="lazy" src="/img?u=${encodeURIComponent(c.thumbUrl || '')}" alt="">
      ${c.latestChapter ? `<span class="newflag">Chương <b>${c.latestChapter}</b></span>` : ''}</div>
    <div class="tt">${c.name}</div>
    <div class="row"><span class="ch">Chương ${c.latestChapter || '?'}</span></div>
  </a>`;
}

/* ---------- Banner tự chạy ---------- */
const hero = document.getElementById('hero');
if (hero) {
  const slides = [...hero.querySelectorAll('.slide')];
  const dots = [...hero.querySelectorAll('.hero-dots button')];
  let cur = 0, timer;
  const show = (i) => {
    cur = (i + slides.length) % slides.length;
    slides.forEach((s, k) => s.classList.toggle('on', k === cur));
    dots.forEach((d, k) => d.classList.toggle('on', k === cur));
  };
  const start = () => { if (slides.length > 1) timer = setInterval(() => show(cur + 1), 5000); };
  const stop = () => clearInterval(timer);
  dots.forEach(d => d.addEventListener('click', () => { stop(); show(Number(d.dataset.i)); start(); }));
  hero.addEventListener('mouseenter', stop);
  hero.addEventListener('mouseleave', start);
  start();
}

/* ---------- Kiểm tra chương mới ---------- */
const checkmsg = document.getElementById('checkmsg');
async function runCheck(btn) {
  if (btn) btn.disabled = true;
  if (checkmsg) { checkmsg.className = 'checkmsg'; checkmsg.textContent = 'Đang kiểm tra…'; }
  try {
    const { results } = await api('/api/check', { method: 'POST', body: '{}' });
    const withNew = results.filter(r => r.newCount > 0);
    const total = withNew.reduce((a, r) => a + r.newCount, 0);
    if (checkmsg) {
      checkmsg.className = 'checkmsg ok';
      checkmsg.textContent = withNew.length ? `${withNew.length} truyện có ${total} chương mới` : 'Không có chương mới.';
    }
    if (withNew.length) setTimeout(() => location.reload(), 900);
  } catch (e) {
    if (checkmsg) { checkmsg.className = 'checkmsg'; checkmsg.textContent = 'Lỗi kiểm tra: ' + e.message; }
  } finally { if (btn) btn.disabled = false; }
}
document.getElementById('checkNewSide')?.addEventListener('click', e => runCheck(e.target));

/* ---------- Bỏ theo dõi ngay trên card (không cần F5) ---------- */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.unfollow');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  const wrap = btn.closest('.cc-wrap');
  const slug = btn.dataset.slug;
  btn.disabled = true;
  try {
    await api('/api/unfollow', { method: 'POST', body: JSON.stringify({ slug }) });
    const box = wrap.closest('.box');
    const grid = wrap.parentElement;
    wrap.remove();
    // cập nhật số đếm ở tiêu đề
    const cnt = box?.querySelector('.boxhead .cnt');
    if (cnt) { const n = parseInt(cnt.textContent, 10); if (!Number.isNaN(n)) cnt.textContent = String(Math.max(0, n - 1)); }
    // hết card thì bỏ luôn cả khối
    if (grid && !grid.querySelector('.cc-wrap')) box?.remove();
  } catch (err) { btn.disabled = false; alert('Lỗi bỏ theo dõi: ' + err.message); }
});

/* ---------- Theo dõi / bỏ theo dõi (trang chi tiết) ---------- */
const fb = document.getElementById('followBtn');
fb?.addEventListener('click', async () => {
  const slug = fb.dataset.slug;
  const on = fb.classList.contains('on');
  try {
    await api(on ? '/api/unfollow' : '/api/follow', { method: 'POST', body: JSON.stringify({ slug }) });
    fb.classList.toggle('on');
    fb.textContent = on ? '+ Theo dõi' : '✓ Đang theo dõi';
  } catch (e) { alert('Lỗi: ' + e.message); }
});

/* ---------- Xem tất cả thể loại ---------- */
document.querySelectorAll('[data-more]').forEach(btn => {
  const closed = btn.textContent.trim();
  btn.addEventListener('click', () => {
    const chips = btn.parentElement.querySelector('.chips');
    const open = chips.classList.toggle('open');
    btn.textContent = open ? 'Thu gọn ▴' : closed;
  });
});

/* ---------- Tìm truyện ---------- */
const q = document.getElementById('q');
if (q) {
  const grid = document.getElementById('grid');
  const hint = document.getElementById('hint');
  let t;
  async function doSearch() {
    if (!q.value.trim()) { grid.innerHTML = ''; if (hint) hint.style.display = ''; return; }
    if (hint) hint.style.display = 'none';
    grid.innerHTML = '<div style="padding:24px 16px;color:var(--text-faint)">Đang tìm…</div>';
    try {
      const { items } = await api('/api/search?q=' + encodeURIComponent(q.value));
      grid.innerHTML = items.length ? items.map(cardHtml).join('')
        : '<div style="padding:24px 16px;color:var(--text-faint)">Không tìm thấy truyện nào.</div>';
    } catch (e) { grid.innerHTML = `<div style="padding:24px 16px;color:var(--text-faint)">Lỗi: ${e.message}</div>`; }
  }
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(doSearch, 350); });
  if (q.value.trim()) doSearch();
}

/* ---------- Duyệt theo thể loại ---------- */
const chips = document.getElementById('chips');
if (chips) {
  const grid = document.getElementById('grid');
  const pager = document.getElementById('pager');
  const label = document.getElementById('browseLabel');
  let filter = { type: 'truyen-moi', name: 'Mới cập nhật' };

  async function load(page = 1) {
    grid.innerHTML = '<div style="padding:24px 16px;color:var(--text-faint)">Đang tải…</div>';
    const qs = filter.cat ? `category=${encodeURIComponent(filter.cat)}&page=${page}` : `type=${filter.type}&page=${page}`;
    try {
      const { items, pagination } = await api('/api/browse?' + qs);
      grid.innerHTML = items.length ? items.map(cardHtml).join('')
        : '<div style="padding:24px 16px;color:var(--text-faint)">Không có truyện.</div>';
      if (label) label.textContent = filter.name;
      renderPager(pagination, page);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { grid.innerHTML = `<div style="padding:24px 16px;color:var(--text-faint)">Lỗi: ${e.message}</div>`; }
  }

  function renderPager(pg, page) {
    if (!pager) return;
    pager.innerHTML = '';
    if (!pg || !pg.totalItems) return;
    const per = pg.totalItemsPerPage || 24;
    const last = Math.max(1, Math.ceil(pg.totalItems / per));
    const mk = (n, txt = n, sel = false, dis = false) => {
      const b = document.createElement('button');
      b.textContent = txt; if (sel) b.className = 'sel'; if (dis) b.disabled = true;
      if (!dis && !sel) b.addEventListener('click', () => load(n));
      return b;
    };
    pager.append(mk(page - 1, '‹', false, page <= 1));
    const from = Math.max(1, page - 2), to = Math.min(last, page + 2);
    if (from > 1) pager.append(mk(1));
    for (let i = from; i <= to; i++) pager.append(mk(i, String(i), i === page));
    if (to < last) pager.append(mk(last));
    pager.append(mk(page + 1, '›', false, page >= last));
  }

  chips.addEventListener('click', (e) => {
    const b = e.target.closest('.gchip'); if (!b) return;
    chips.querySelectorAll('.gchip').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    filter = b.dataset.cat ? { cat: b.dataset.cat, name: b.textContent.trim() } : { type: b.dataset.type, name: 'Mới cập nhật' };
    load(1);
  });
  load(1);
}
