/**
 * Chẩn đoán "vì sao ảnh vỡ" — TỪ MÁY CHỦ.
 *
 * Lý do tồn tại: ảnh vỡ đã hai lần phải sửa mò. Máy ở nhà bị nhà mạng chặn CDN
 * nên dò ở đó không nói lên điều gì; còn máy chủ thì không xem được log. Công cụ
 * này bắt chính máy chủ thử từng tổ hợp host × referer rồi báo lại NGUYÊN VĂN
 * mã trả về, để biết CDN chết hẳn hay chỉ chặn hotlink — hai thứ chữa khác nhau.
 *
 * Dùng lại đúng buildReferers/mirrorsFor của proxy, nên kết quả phản ánh cái
 * proxy thật sự làm chứ không phải một phép thử song song dễ lệch.
 */
import { buildReferers, mirrorsFor } from '../routes/image.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export function createImageDoctor({
  source, imageHosts, refererFor, altReferer, fetchFn = fetch,
  timeoutMs = 8000, now = () => Date.now(),
} = {}) {

  async function attempt(url, referer) {
    const t0 = now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchFn(url, {
        signal: ctrl.signal,
        headers: { 'user-agent': UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8', Referer: referer },
      });
      let bytes = 0;
      if (res.ok) { try { bytes = (await res.arrayBuffer()).byteLength; } catch { bytes = 0; } }
      return {
        host: new URL(url).hostname, referer, ok: res.ok, status: res.status,
        contentType: res.headers.get('content-type') || '', bytes, ms: now() - t0,
      };
    } catch (err) {
      return {
        host: (() => { try { return new URL(url).hostname; } catch { return url; } })(),
        referer, ok: false, ms: now() - t0,
        error: err?.name === 'AbortError' ? 'Quá hạn (không phản hồi)' : String(err?.cause?.code || err?.message || 'Lỗi'),
      };
    } finally { clearTimeout(timer); }
  }

  /** Một câu kết luận người thường đọc được, kèm hướng chữa. */
  function verdictOf(attempts) {
    if (!attempts.length) return 'Không thử được lần nào.';
    const win = attempts.find(a => a.ok);
    if (win) return `Lấy được ảnh với referer ${win.referer} (${win.bytes} byte). Ảnh vỡ ở máy bạn là do mạng/trình duyệt, không phải máy chủ.`;
    const hosts = [...new Set(attempts.map(a => a.host))];
    const alive = hosts.filter(h => attempts.some(a => a.host === h && a.status));
    if (!alive.length) return 'Không host nào phản hồi — CDN của nguồn chết hoặc bị chặn từ máy chủ. Phải đổi sang nguồn khác.';
    const codes = [...new Set(attempts.filter(a => a.status).map(a => a.status))].join(', ');
    return `Host còn sống nhưng từ chối hết (mã ${codes}) — nhiều khả năng chặn hotlink và chưa có referer nào đúng.`;
  }

  return {
    /** Thử mọi tổ hợp cho MỘT url ảnh cụ thể. */
    async diagnoseUrl(imageUrl) {
      if (!imageUrl) return { error: 'Thiếu địa chỉ ảnh' };
      const allowed = imageHosts ? imageHosts.allowed(imageUrl) : true;
      const attempts = [];
      for (const u of mirrorsFor(imageUrl)) {
        for (const ref of buildReferers(u, { refererFor, altReferer })) {
          attempts.push(await attempt(u, ref));
          if (attempts[attempts.length - 1].ok) break;
        }
        if (attempts.length && attempts[attempts.length - 1].ok) break;
      }
      return { imageUrl, allowed, attempts, verdict: verdictOf(attempts) };
    },

    /**
     * Lấy ảnh ĐẦU của một chương rồi chẩn đoán. Nhận slug (có tiền tố như đang
     * lưu) + tên chương, đúng những gì người dùng thấy trên thanh địa chỉ.
     */
    async diagnoseChapter(slug, chapterName) {
      if (!source) return { error: 'Chưa có nguồn' };
      let detail;
      try { detail = await source.detail(slug); }
      catch (e) { return { error: 'Không mở được truyện: ' + (e.message || e) }; }
      const chapters = detail.chapters || [];
      const cur = chapters.find(c => String(c.name) === String(chapterName)) || chapters[0];
      if (!cur) return { error: 'Truyện không có chương nào' };
      let images = [];
      try { ({ images = [] } = await source.chapter(cur.apiUrl)); }
      catch (e) { return { error: 'Không đọc được chương: ' + (e.message || e) }; }
      if (!images.length) return { error: 'Chương này nguồn không trả về ảnh nào' };
      const out = await this.diagnoseUrl(images[0].url);
      return { ...out, comic: detail.name, chapter: cur.name, imageCount: images.length };
    },
  };
}
