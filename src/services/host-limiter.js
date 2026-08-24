/**
 * Giới hạn số request ĐỒNG THỜI tới cùng một host, có xếp hàng và CÓ LÀN ƯU TIÊN.
 *
 * Lý do tồn tại (đo thật trên máy chủ): CDN nguồn chịu tải LẺ tốt (1 ảnh =
 * 1070ms OK) nhưng dội 8 ảnh cùng lúc thì rớt 7/8 (HTTP 502/504). Trang đọc lại
 * nạp trước rất hăng, nên không xếp hàng là ảnh vỡ lỗ chỗ.
 *
 * Hai làn:
 *  - 'fg' (mặc định): ảnh người đọc ĐANG NHÌN. Được chen trước làn nền; chờ quá
 *    lâu thì cho đi luôn (thà chậm còn hơn treo trắng màn hình).
 *  - 'bg': nạp trước/ủ cache. Bị ép nhường: mỗi host chỉ 1 request nền một lúc,
 *    và chờ quá lâu thì TRẢ LỖI ngay (err.busy=true) để người gọi quay lại sau —
 *    tuyệt đối không được giành chỗ của ảnh đang nhìn.
 *
 * Xếp hàng theo host chứ không toàn cục: nhiều nguồn khác nhau vẫn chạy song song.
 */
export function createHostLimiter({
  limit = 3,               // tổng request đồng thời tới MỘT host (cả hai làn)
  bgLimit = 1,             // riêng làn nền không vượt số này
  maxWaitMs = 10000,       // fg: chờ quá thì cho đi luôn
  bgMaxWaitMs = 4000,      // bg: chờ quá thì trả lỗi busy
  now = () => Date.now(),
} = {}) {
  const lanes = new Map();  // host -> { running: {fg,bg}, q: {fg:[],bg:[]} }

  const laneOf = (host) => {
    let l = lanes.get(host);
    if (!l) { l = { running: { fg: 0, bg: 0 }, q: { fg: [], bg: [] } }; lanes.set(host, l); }
    return l;
  };
  const total = (l) => l.running.fg + l.running.bg;

  /** Nhả chỗ xong thì cho người chờ vào: fg TRƯỚC, bg chỉ khi fg hết hàng. */
  function admit(l) {
    while (l.q.fg.length && total(l) < limit) { l.running.fg++; l.q.fg.shift().go(); }
    while (l.q.bg.length && total(l) < limit && l.running.bg < bgLimit) { l.running.bg++; l.q.bg.shift().go(); }
  }

  function release(host, lane) {
    const l = lanes.get(host);
    if (!l) return;
    l.running[lane]--;
    admit(l);
    if (total(l) <= 0 && !l.q.fg.length && !l.q.bg.length) lanes.delete(host);
  }

  function acquire(host, lane) {
    const l = laneOf(host);
    const canRun = lane === 'fg'
      ? total(l) < limit
      : total(l) < limit && l.running.bg < bgLimit;
    if (canRun) { l.running[lane]++; return Promise.resolve(); }

    return new Promise((resolve, reject) => {
      const entry = { go: () => { clearTimeout(timer); resolve(); } };
      l.q[lane].push(entry);
      const wait = lane === 'fg' ? maxWaitMs : bgMaxWaitMs;
      const timer = setTimeout(() => {
        const i = l.q[lane].indexOf(entry);
        if (i < 0) return;                       // đã được cho vào rồi
        l.q[lane].splice(i, 1);
        if (lane === 'fg') { l.running.fg++; resolve(); }   // fg: cho đi luôn
        else reject(Object.assign(new Error('host đang bận, quay lại sau'), { busy: true }));
      }, wait);
    });
  }

  return {
    /** Chạy fn() trong làn `lane` của host này. Làn nền có thể ném err.busy. */
    async run(host, fn, lane = 'fg') {
      const h = String(host || '');
      const ln = lane === 'bg' ? 'bg' : 'fg';
      await acquire(h, ln);
      try { return await fn(); } finally { release(h, ln); }
    },
    /** Cho test + chẩn đoán. */
    stats(host) {
      const l = lanes.get(String(host || ''));
      return {
        running: l ? total(l) : 0,
        queued: l ? l.q.fg.length + l.q.bg.length : 0,
        bgRunning: l?.running.bg || 0,
      };
    },
  };
}
