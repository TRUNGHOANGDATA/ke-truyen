/**
 * Giới hạn số request ĐỒNG THỜI tới cùng một host, có xếp hàng, LÀN ƯU TIÊN, và
 * TỰ SIẾT theo sức khoẻ CDN.
 *
 * Lý do tồn tại (đo thật trên máy chủ): các CDN cư xử KHÁC NHAU rõ rệt —
 *   TruyenQQ (truyenvua.com)     dội 8 ảnh cùng lúc = 8/8 OK;
 *   NetTruyen (truyenonline.cc)  dội 8 ảnh cùng lúc = 1/8 OK, rớt 7 (502/504).
 * Nên KHÔNG siết đều tay: CDN khoẻ để chạy full tốc, CDN hay 5xx thì tự hạ về
 * 1 luồng + chèn khoảng nghỉ giữa các phát. Tự học từ chính phản hồi CDN, không
 * hardcode host nào — cùng tinh thần với "tự học host ảnh / tự học referer".
 *
 * Hai làn:
 *  - 'fg' (mặc định): ảnh người đọc ĐANG NHÌN. Chen trước làn nền; chờ quá lâu
 *    thì cho đi luôn (thà chậm còn hơn treo trắng màn hình).
 *  - 'bg': nạp trước/ủ cache. Nhường: chờ quá lâu thì TRẢ LỖI (err.busy=true) để
 *    người gọi quay lại sau — không giành chỗ của ảnh đang nhìn.
 *
 * Xếp hàng theo host chứ không toàn cục: nhiều nguồn khác nhau vẫn chạy song song.
 */
export function createHostLimiter({
  limit = 3,               // tổng request đồng thời tới MỘT host khoẻ
  bgLimit = 1,             // riêng làn nền không vượt số này (khi host khoẻ)
  maxWaitMs = 10000,       // fg: chờ quá thì cho đi luôn
  bgMaxWaitMs = 4000,      // bg: chờ quá thì trả lỗi busy
  sickLimit = 1,           // host đang "ốm" (hay 5xx) chỉ cho 1 request một lúc
  cooldownMs = 600,        // host ốm: nghỉ ngần này giữa hai phát -> hết bị CDN dồn
  healAfter = 5,           // ốm mà đạt ngần này lần OK liên tiếp thì coi như khoẻ lại
  now = () => Date.now(),
} = {}) {
  // host -> { running:{fg,bg}, q:{fg:[],bg:[]}, sick, okStreak, cooling }
  const lanes = new Map();

  const laneOf = (host) => {
    let l = lanes.get(host);
    if (!l) l = { running: { fg: 0, bg: 0 }, q: { fg: [], bg: [] }, sick: false, okStreak: 0, cooling: false };
    lanes.set(host, l);
    return l;
  };
  const total = (l) => l.running.fg + l.running.bg;
  const capOf = (l) => (l.sick ? sickLimit : limit);
  const bgCapOf = (l) => (l.sick ? sickLimit : bgLimit);

  const maybeDrop = (host, l) => {
    if (total(l) <= 0 && !l.q.fg.length && !l.q.bg.length && !l.cooling && !l.sick) lanes.delete(host);
  };

  /** Nhả chỗ xong thì cho người chờ vào: fg TRƯỚC, bg chỉ khi fg hết hàng. */
  function admit(l) {
    if (l.cooling) return;                                 // đang nghỉ cooldown -> khoan
    while (l.q.fg.length && total(l) < capOf(l)) { l.running.fg++; l.q.fg.shift().go(); }
    while (l.q.bg.length && total(l) < capOf(l) && l.running.bg < bgCapOf(l)) { l.running.bg++; l.q.bg.shift().go(); }
  }

  function release(host, lane) {
    const l = lanes.get(host);
    if (!l) return;
    l.running[lane]--;
    // Host ốm: chèn khoảng nghỉ trước khi cho phát kế -> CDN không thấy bị dồn.
    if (l.sick && cooldownMs > 0) {
      l.cooling = true;
      setTimeout(() => { l.cooling = false; admit(l); maybeDrop(host, l); }, cooldownMs).unref?.();
    } else {
      admit(l);
    }
    maybeDrop(host, l);
  }

  function acquire(host, lane) {
    const l = laneOf(host);
    const canRun = !l.cooling && (lane === 'fg'
      ? total(l) < capOf(l)
      : total(l) < capOf(l) && l.running.bg < bgCapOf(l));
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

    /** CDN vừa trả 5xx/429 -> đánh dấu host "ốm": siết còn 1 luồng + nghỉ giữa phát. */
    penalize(host) {
      const l = laneOf(String(host || ''));
      l.sick = true;
      l.okStreak = 0;
    },

    /** CDN vừa trả ảnh OK -> đủ chuỗi OK thì gỡ "ốm", cho chạy full tốc lại. */
    reward(host) {
      const l = lanes.get(String(host || ''));
      if (!l || !l.sick) return;
      if (++l.okStreak >= healAfter) { l.sick = false; l.okStreak = 0; }
    },

    /** Cho test + chẩn đoán. */
    stats(host) {
      const l = lanes.get(String(host || ''));
      return {
        running: l ? total(l) : 0,
        queued: l ? l.q.fg.length + l.q.bg.length : 0,
        bgRunning: l?.running.bg || 0,
        sick: !!l?.sick,
      };
    },
  };
}
