import { api } from './common.js';

const sys = document.getElementById('sysbox');

async function runCheck(btn) {
  if (btn) btn.disabled = true;
  if (sys) sys.textContent = 'Đang kiểm tra…';
  try {
    const { results } = await api('/api/check', { method: 'POST', body: '{}' });
    const withNew = results.filter(r => r.newCount > 0);
    const total = withNew.reduce((a, r) => a + r.newCount, 0);
    if (sys) sys.textContent = withNew.length
      ? `${withNew.length} truyện có ${total} chương mới`
      : 'Không có chương mới.';
    if (withNew.length) setTimeout(() => location.reload(), 900);
  } catch (e) {
    if (sys) sys.textContent = 'Lỗi kiểm tra: ' + e.message;
  } finally { if (btn) btn.disabled = false; }
}

document.getElementById('checkNew')?.addEventListener('click', e => runCheck(e.target));
document.getElementById('checkNewSide')?.addEventListener('click', e => runCheck(e.target));

// follow toggle on detail page
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

// search page live search
const q = document.getElementById('q');
let t;
q?.addEventListener('input', () => {
  clearTimeout(t);
  t = setTimeout(async () => {
    const grid = document.getElementById('grid');
    if (!q.value.trim()) { grid.innerHTML = ''; return; }
    try {
      const { items } = await api('/api/search?q=' + encodeURIComponent(q.value));
      grid.innerHTML = items.map(c => `
        <a class="cc" href="/truyen/${c.slug}">
          <div class="thumb"><img loading="lazy" src="/img?u=${encodeURIComponent(c.thumbUrl || '')}" alt=""></div>
          <div class="tt">${c.name}</div>
          <div class="row"><span class="ch">Chương ${c.latestChapter || '?'}</span></div>
        </a>`).join('');
    } catch (e) { grid.innerHTML = '<div style="padding:20px;color:var(--text-faint)">Lỗi: ' + e.message + '</div>'; }
  }, 350);
});

// browse page: load recent list
if (document.querySelector('.boxhead h2')?.textContent.includes('Duyệt')) {
  (async () => {
    const grid = document.getElementById('grid');
    try {
      const { items } = await api('/api/browse?type=truyen-moi&page=1');
      grid.innerHTML = items.map(c => `
        <a class="cc" href="/truyen/${c.slug}">
          <div class="thumb"><img loading="lazy" src="/img?u=${encodeURIComponent(c.thumbUrl || '')}" alt="">
            ${c.latestChapter ? `<span class="newflag">Chương <b>${c.latestChapter}</b></span>` : ''}</div>
          <div class="tt">${c.name}</div>
          <div class="row"><span class="ch">Chương ${c.latestChapter || '?'}</span></div>
        </a>`).join('');
    } catch (e) { if (grid) grid.innerHTML = '<div style="padding:20px;color:var(--text-faint)">Lỗi: ' + e.message + '</div>'; }
  })();
}
