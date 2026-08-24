/**
 * Ủ SẴN cả chương vào cache đĩa — máy chủ tự đi lấy ảnh theo nhịp của nó.
 *
 * Lý do tồn tại: CDN nguồn chịu tải lẻ tốt nhưng dội song song là chặn (đo thật:
 * 8 ảnh cùng lúc rớt 7). Người đọc thì không thể chờ tuần tự. Lời giải: ngay khi
 * mở trang đọc, máy chủ lặng lẽ kéo TUẦN TỰ từng ảnh của chương về cache đĩa
 * (làn nền, nhường ảnh đang nhìn); người đọc cuộn tới đâu phần lớn đã trúng cache.
 *
 * Chạy nền tuyệt đối: không giữ request, lỗi ảnh nào bỏ ảnh đó, không bao giờ ném.
 */
export function createChapterPrewarm({ cache, fetcher, maxRemember = 100 } = {}) {
  const done = new Set();     // chương đã ủ gần đây -> mở lại không ủ nữa
  const order = [];
  let chain = Promise.resolve();   // tuần tự toàn cục: server chỉ ủ một chương một lúc
  let queuedCount = 0;

  return {
    /**
     * key: định danh chương (vd "slug/19"); urls: URL ảnh GỐC (chưa gói).
     * Trả promise của cả dây (để test await được) — nơi gọi cứ fire-and-forget.
     */
    queue(key, urls = []) {
      if (!key || !fetcher || done.has(key)) return chain;
      done.add(key);
      order.push(key);
      if (order.length > maxRemember) done.delete(order.shift());

      queuedCount++;
      chain = chain.then(async () => {
        for (const url of urls) {
          if (!url || cache?.get?.(url)) continue;         // có rồi thì thôi
          try {
            const got = await fetcher.get(url, { lane: 'bg' });
            if (got) cache?.put?.(url, got.buf, got.contentType);
          } catch { /* làn nền bận / ảnh lỗi -> bỏ qua, người đọc vẫn có làn fg */ }
        }
      }).catch(() => {}).finally(() => { queuedCount--; });
      return chain;
    },

    /** Số chương đang chờ ủ (cho chẩn đoán). */
    pending: () => queuedCount,
  };
}
