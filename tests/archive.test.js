import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createSchema } from '../src/db/migrations.js';
import { createArchive } from '../src/services/archive.js';

const CH = [
  { comic_slug: 's', chapter_name: '1', api_url: 'https://qq.test/truyen-tranh/s-chap-1', order_index: 0 },
  { comic_slug: 's', chapter_name: '2', api_url: 'https://qq.test/truyen-tranh/s-chap-2', order_index: 1 },
];

function setup({ imagesPerChapter = 2, failOn = null, bytes = 100 } = {}) {
  const db = openDb(':memory:');
  createSchema(db);
  for (const c of CH) {
    db.prepare(`INSERT INTO chapters (comic_slug, chapter_name, chapter_title, api_url, order_index)
                VALUES (?,?,'',?,?)`).run(c.comic_slug, c.chapter_name, c.api_url, c.order_index);
  }

  const uploaded = [];
  const drive = {
    configured: true,
    async ensureFolder(path) { return 'folder:' + path; },
    async upload({ name, parentId, buffer }) {
      uploaded.push({ name, parentId, size: buffer.byteLength });
      return { id: `drive-${uploaded.length}`, size: buffer.byteLength };
    },
  };

  const source = {
    async chapter(url) {
      const n = url.endsWith('-1') ? '1' : '2';
      return { images: Array.from({ length: imagesPerChapter }, (_, i) => ({ page: i, url: `https://cdn.test/${n}/${i}.jpg` })) };
    },
  };

  const fetchFn = async (url) => {
    if (failOn && String(url).includes(failOn)) return { ok: false, status: 500 };
    const b = Buffer.alloc(bytes, 1);
    return {
      ok: true, status: 200,
      arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      headers: { get: () => 'image/jpeg' },
    };
  };

  return { db, uploaded, archive: createArchive({ db, drive, source, fetchFn, politeDelayMs: 0 }) };
}

test('lưu cả truyện: upload đủ ảnh và ghi chỉ mục', async () => {
  const { archive, uploaded } = setup();
  const job = await archive.archiveComic('s');
  assert.equal(job.state, 'done');
  assert.equal(job.done_chapters, 2);
  assert.equal(job.total_chapters, 2);
  assert.equal(uploaded.length, 4, 'phải upload 2 chương x 2 ảnh');
  assert.equal(archive.stats().images, 4);
  assert.equal(archive.chaptersSaved('s'), 2);
});

test('đặt tên file theo số trang và xếp vào thư mục theo chương', async () => {
  const { archive, uploaded } = setup();
  await archive.archiveComic('s');
  assert.equal(uploaded[0].name, '000.jpg');
  assert.equal(uploaded[1].name, '001.jpg');
  assert.match(uploaded[0].parentId, /folder:truyen\/s\/1$/);
  assert.match(uploaded[2].parentId, /folder:truyen\/s\/2$/);
});

test('chạy lại thì bỏ qua ảnh đã lưu (tiếp tục chỗ dở, không tải lại)', async () => {
  const { archive, uploaded } = setup();
  await archive.archiveComic('s');
  const first = uploaded.length;
  await archive.archiveComic('s');
  assert.equal(uploaded.length, first, 'lần hai không được upload lại gì');
});

test('lookup cho biết ảnh đã có trên Drive chưa', async () => {
  const { archive } = setup();
  assert.equal(archive.lookup('https://cdn.test/1/0.jpg'), null);
  await archive.archiveComic('s');
  const hit = archive.lookup('https://cdn.test/1/0.jpg');
  assert.ok(hit && hit.drive_id, 'phải trả về drive_id');
});

test('cộng dồn dung lượng đã lưu', async () => {
  const { archive } = setup({ bytes: 500 });
  const job = await archive.archiveComic('s');
  assert.equal(job.bytes, 4 * 500);
  assert.equal(archive.stats().bytes, 4 * 500);
});

test('tải ảnh lỗi thì job chuyển sang error kèm lý do, không làm sập server', async () => {
  const { archive } = setup({ failOn: '/2/' });
  const job = await archive.archiveComic('s');
  assert.equal(job.state, 'error');
  assert.match(job.message, /tải ảnh lỗi 500/);
  assert.equal(job.done_chapters, 1, 'chương 1 vẫn phải lưu xong');
});

test('huỷ giữa chừng thì job ở trạng thái cancelled, giữ phần đã lưu', async () => {
  // Huỷ ngay khi đang tải ảnh (bấm "Lưu" lại sau đó vẫn phải chạy tiếp được)
  const db = openDb(':memory:');
  createSchema(db);
  for (const c of CH) {
    db.prepare(`INSERT INTO chapters (comic_slug, chapter_name, chapter_title, api_url, order_index)
                VALUES (?,?,'',?,?)`).run(c.comic_slug, c.chapter_name, c.api_url, c.order_index);
  }
  const holder = {};
  let n = 0;
  const b = Buffer.alloc(10, 1);
  const archive = createArchive({
    db,
    drive: { configured: true, async ensureFolder(p) { return 'f:' + p; },
             async upload({ buffer }) { return { id: 'd' + ++n, size: buffer.byteLength }; } },
    source: { async chapter() { return { images: [0, 1, 2].map(i => ({ page: i, url: `https://cdn.test/x/${i}.jpg` })) }; } },
    fetchFn: async () => {
      if (++n >= 2) holder.archive.cancel('s');   // huỷ khi đang chạy
      return { ok: true, status: 200,
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        headers: { get: () => 'image/jpeg' } };
    },
    politeDelayMs: 0,
  });
  holder.archive = archive;

  const job = await archive.archiveComic('s');
  assert.equal(job.state, 'cancelled');
  assert.ok(job.done_chapters < 2, 'không được coi là xong hết');
});

test('job() trả trạng thái đã lưu trong DB', async () => {
  const { archive } = setup();
  assert.equal(archive.job('s'), null);
  await archive.archiveComic('s');
  assert.equal(archive.job('s').state, 'done');
});
