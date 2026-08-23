import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSiteProber, safeTarget } from '../src/services/site-prober.js';

const NT_HOME = `<html><body><div class="items">
  <div class="item"><a href="https://x.com/truyen-tranh/vo-than-hoang-kim">Võ Thần</a></div>
  <div class="item"><a href="https://x.com/truyen-tranh/nguyen-ton">Nguyên Tôn</a></div>
</div><div class="page-chapter"></div></body></html>`;

const PARKED = '<html><body><h1>Tên miền này đang rao bán</h1></body></html>';

// Đồng hồ giả: mỗi lần gọi nhích 120ms -> số ms trong kết quả đoán trước được.
function fakeClock(step = 120) { let t = 0; return () => (t += step) - step; }

const okRes = (html, url) => ({ ok: true, status: 200, url, async text() { return html; } });

test('safeTarget nhận tên miền công khai, thêm https khi thiếu', () => {
  assert.equal(safeTarget('nettruyenar.com'), 'https://nettruyenar.com');
  assert.equal(safeTarget('https://nettruyenar.com/tim-truyen?x=1'), 'https://nettruyenar.com');
});

test('safeTarget chặn localhost / mạng nội bộ / giao thức lạ (SSRF)', () => {
  for (const bad of [
    'http://localhost:3000', 'http://127.0.0.1', 'http://10.0.0.5', 'http://192.168.1.1',
    'http://169.254.169.254', 'http://172.16.0.1', 'http://172.31.255.1',
    'file:///etc/passwd', 'ftp://a.com', 'khong-phai-url', '',
  ]) assert.equal(safeTarget(bad), null, 'phải chặn: ' + bad);
});

test('trang sống + đúng khung NetTruyen -> gợi ý dùng lại adapter cũ', async () => {
  const p = createSiteProber({ now: fakeClock(), fetchFn: async () => okRes(NT_HOME, 'https://x.com/') });
  const [r] = await p.probeAll(['x.com']);
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.theme, 'nettruyen');
  assert.equal(r.adapter, 'nettruyen.js');
  assert.equal(r.comicCount, 2);
  assert.equal(r.sample, 'vo-than-hoang-kim');
  assert.equal(r.ms, 120);
});

test('trang đỗ tên miền: có 200 nhưng không có link truyện -> coi là không dùng được', async () => {
  const p = createSiteProber({ now: fakeClock(), fetchFn: async () => okRes(PARKED, 'https://x.com/') });
  const [r] = await p.probeAll(['x.com']);
  assert.equal(r.ok, false);
  assert.equal(r.comicCount, 0);
  assert.equal(r.theme, null);
});

test('báo lại khi bị chuyển hướng sang tên miền khác', async () => {
  const p = createSiteProber({ now: fakeClock(), fetchFn: async () => okRes(NT_HOME, 'https://y.com/') });
  const [r] = await p.probeAll(['x.com']);
  assert.equal(r.finalUrl, 'https://y.com/');
});

test('trang chết chỉ làm hỏng dòng của nó, các trang khác vẫn có kết quả', async () => {
  const p = createSiteProber({
    now: fakeClock(),
    fetchFn: async (url) => {
      if (url.includes('chet.com')) throw Object.assign(new Error('timeout'), { name: 'AbortError' });
      return okRes(NT_HOME, url);
    },
  });
  const rs = await p.probeAll(['chet.com', 'song.com']);
  assert.equal(rs.length, 2);
  assert.equal(rs[0].ok, false);
  assert.match(rs[0].error, /Quá hạn/);
  assert.equal(rs[1].ok, true);
});

test('địa chỉ không hợp lệ báo lỗi chứ không gọi mạng', async () => {
  let goi = 0;
  const p = createSiteProber({ fetchFn: async () => { goi++; return okRes(NT_HOME, 'x'); } });
  const [r] = await p.probeAll(['http://127.0.0.1']);
  assert.equal(r.ok, false);
  assert.equal(goi, 0);
});

test('chỉ dò tối đa 20 trang một lần', async () => {
  const p = createSiteProber({ now: fakeClock(), fetchFn: async (u) => okRes(NT_HOME, u) });
  const rs = await p.probeAll(Array.from({ length: 30 }, (_, i) => `site${i}.com`));
  assert.equal(rs.length, 20);
});
