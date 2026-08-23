import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createSettings } from '../src/services/settings.js';
import { createImageHosts } from '../src/services/image-hosts.js';

function setup() {
  const db = openDb(':memory:'); createSchema(db);
  const settings = createSettings(db);
  return { settings, hosts: createImageHosts(settings, ['truyenqqko.com', 'otruyencdn.com']) };
}

test('cho qua host tĩnh + subdomain của nó', () => {
  const { hosts } = setup();
  assert.ok(hosts.allowed('https://truyenqqko.com/a.jpg'));
  assert.ok(hosts.allowed('https://sv1.otruyencdn.com/a.jpg'));   // subdomain
  assert.ok(!hosts.allowed('https://hinhtruyen.com/a.jpg'));      // chưa biết
});

test('tự học host mới khi web dựng link, rồi cho qua', () => {
  const { hosts } = setup();
  assert.ok(!hosts.allowed('https://hinhtruyen.com/a.jpg'));
  hosts.learn('https://hinhtruyen.com/1463/0.jpg');
  assert.ok(hosts.allowed('https://hinhtruyen.com/x/y.jpg'));     // giờ chấp nhận
});

test('học rồi thì lưu bền (service mới đọc lại được)', () => {
  const { settings, hosts } = setup();
  hosts.learn('https://cdnmoi.net/a.jpg');
  const hosts2 = createImageHosts(settings, ['truyenqqko.com']);  // dựng lại từ cùng settings
  assert.ok(hosts2.allowed('https://cdnmoi.net/z.jpg'));
});

/* ---------- Nhớ referer lấy được ảnh theo từng host CDN ---------- */

test('chưa học thì không có referer gợi ý', () => {
  const { hosts } = setup();
  assert.equal(hosts.knownReferer('https://cdn3.cloud-zzz.com/a/0.jpg'), '');
});

test('nhớ referer theo host, dùng lại cho ảnh khác cùng host', () => {
  const { hosts } = setup();
  hosts.rememberReferer('https://cdn3.cloud-zzz.com/a/0.jpg', 'https://nettruyenar.com/');
  assert.equal(hosts.knownReferer('https://cdn3.cloud-zzz.com/b/9.jpg'), 'https://nettruyenar.com/');
  assert.equal(hosts.knownReferer('https://khac.com/b/9.jpg'), '', 'host khác thì không lây');
});

test('referer đã nhớ lưu bền qua lần dựng sau', () => {
  const { settings, hosts } = setup();
  hosts.rememberReferer('https://static3.kptackpte.com/a/0.jpg', 'https://nettruyenx.net/');
  const lai = createImageHosts(settings, []);
  assert.equal(lai.knownReferer('https://static3.kptackpte.com/z.jpg'), 'https://nettruyenx.net/');
});

test('referer đổi thì ghi đè bản cũ', () => {
  const { hosts } = setup();
  hosts.rememberReferer('https://cdn.x.com/a.jpg', 'https://cu.com/');
  hosts.rememberReferer('https://cdn.x.com/a.jpg', 'https://moi.com/');
  assert.equal(hosts.knownReferer('https://cdn.x.com/b.jpg'), 'https://moi.com/');
});

test('KHÔNG học IP nội bộ / localhost (chống SSRF)', () => {
  const { hosts } = setup();
  ['http://127.0.0.1/x', 'http://localhost/x', 'http://169.254.169.254/latest/meta-data',
   'http://10.0.0.5/x', 'http://192.168.1.1/x', 'http://172.16.0.1/x'].forEach(u => {
    hosts.learn(u);
    assert.ok(!hosts.allowed(u), 'không được cho qua: ' + u);
  });
});
