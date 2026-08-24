import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHostLimiter } from '../src/services/host-limiter.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Chạy n việc song song trên cùng host, ghi lại đỉnh số việc chạy đồng thời. */
async function peakOf(limiter, host, n, workMs = 20) {
  let dangChay = 0, dinh = 0;
  await Promise.all(Array.from({ length: n }, () => limiter.run(host, async () => {
    dangChay++; dinh = Math.max(dinh, dangChay);
    await sleep(workMs);
    dangChay--;
  })));
  return dinh;
}

test('không bao giờ vượt quá giới hạn trên cùng một host', async () => {
  const l = createHostLimiter({ limit: 3 });
  assert.equal(await peakOf(l, 'cdn.com', 12), 3);
});

test('việc xếp hàng vẫn chạy hết, không mất cái nào', async () => {
  const l = createHostLimiter({ limit: 2 });
  let xong = 0;
  await Promise.all(Array.from({ length: 9 }, () => l.run('cdn.com', async () => { await sleep(5); xong++; })));
  assert.equal(xong, 9);
});

test('host khác nhau xếp hàng riêng, không cản nhau', async () => {
  const l = createHostLimiter({ limit: 1 });
  const t0 = Date.now();
  await Promise.all([
    l.run('a.com', () => sleep(40)),
    l.run('b.com', () => sleep(40)),
    l.run('c.com', () => sleep(40)),
  ]);
  assert.ok(Date.now() - t0 < 110, 'ba host phải chạy song song, mất ~40ms chứ không phải 120ms');
});

test('việc ném lỗi vẫn nhả chỗ cho người sau (không kẹt hàng đợi)', async () => {
  const l = createHostLimiter({ limit: 1 });
  await assert.rejects(() => l.run('cdn.com', async () => { throw new Error('hỏng'); }));
  let chay = false;
  await l.run('cdn.com', async () => { chay = true; });
  assert.equal(chay, true);
  assert.deepEqual(l.stats('cdn.com'), { running: 0, queued: 0 });
});

test('trả về đúng giá trị của việc', async () => {
  const l = createHostLimiter({ limit: 2 });
  assert.equal(await l.run('cdn.com', async () => 42), 42);
});

test('chờ quá lâu thì cho đi luôn, thà chậm còn hơn treo', async () => {
  const l = createHostLimiter({ limit: 1, maxWaitMs: 30 });
  let xong = 0;
  const cham = l.run('cdn.com', () => sleep(300));          // giữ chỗ rất lâu
  await Promise.all([
    l.run('cdn.com', async () => { xong++; }),
    l.run('cdn.com', async () => { xong++; }),
  ]);
  assert.equal(xong, 2, 'không được kẹt chờ việc chậm kia xong');
  await cham;
});

test('dọn sạch sau khi xong, không rò bộ nhớ theo host', async () => {
  const l = createHostLimiter({ limit: 2 });
  await peakOf(l, 'cdn.com', 4, 2);
  assert.deepEqual(l.stats('cdn.com'), { running: 0, queued: 0 });
});
