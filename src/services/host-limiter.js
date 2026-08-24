/**
 * Giới hạn số request ĐỒNG THỜI tới cùng một host, có xếp hàng.
 *
 * Lý do tồn tại: trang đọc nạp trước rất hăng (4 luồng + 6 ảnh nhìn trước + tải
 * trước chương sau), nên proxy dội cả chùm chục request vào CDN của nguồn cùng
 * lúc. CDN thấy vậy thì chặn bớt — hệ quả là ảnh vỡ lỗ chỗ, trong khi thử LẺ
 * từng ảnh lại ngon lành (đo thật: 1 ảnh = 315ms, OK ngay lần đầu).
 *
 * Xếp hàng theo host chứ không theo toàn cục: nhiều nguồn khác nhau vẫn chạy
 * song song, chỉ riêng từng CDN là được "gõ cửa từ tốn".
 */
export function createHostLimiter({ limit = 3, maxWaitMs = 10000, now = () => Date.now() } = {}) {
  const lanes = new Map();   // host -> { running, queue: [] }

  const laneOf = (host) => {
    let l = lanes.get(host);
    if (!l) { l = { running: 0, queue: [] }; lanes.set(host, l); }
    return l;
  };

  function release(host) {
    const l = lanes.get(host);
    if (!l) return;
    l.running--;
    const next = l.queue.shift();
    if (next) { l.running++; next(); }
    else if (l.running <= 0 && !l.queue.length) lanes.delete(host);
  }

  /** Chiếm một chỗ cho host; trả về hàm nhả chỗ. Chờ quá lâu thì cứ cho đi. */
  async function acquire(host) {
    const l = laneOf(host);
    if (l.running < limit) { l.running++; return () => release(host); }

    const start = now();
    let timer;
    await new Promise((resolve) => {
      const go = () => { clearTimeout(timer); resolve(); };
      l.queue.push(go);
      // Không để ai kẹt vô hạn: quá hạn thì bỏ hàng đợi mà chạy luôn, thà chậm
      // còn hơn treo. Ghế đã xin thì vẫn đếm để không vọt quá giới hạn nhiều.
      timer = setTimeout(() => {
        const i = l.queue.indexOf(go);
        if (i >= 0) { l.queue.splice(i, 1); l.running++; }
        resolve();
      }, Math.max(0, maxWaitMs - (now() - start)));
    });
    return () => release(host);
  }

  return {
    /** Chạy fn() với ràng buộc số lượng đồng thời của host này. */
    async run(host, fn) {
      const done = await acquire(String(host || ''));
      try { return await fn(); } finally { done(); }
    },
    /** Đang chạy bao nhiêu / xếp hàng bao nhiêu (cho test + chẩn đoán). */
    stats(host) {
      const l = lanes.get(String(host || ''));
      return { running: l?.running || 0, queued: l?.queue.length || 0 };
    },
  };
}
