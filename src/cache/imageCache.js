import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';

const keyOf = (url) => createHash('sha1').update(url).digest('hex');

export function createImageCache({ dir, maxBytes = 2 * 1024 * 1024 * 1024 }) {
  mkdirSync(dir, { recursive: true });

  function paths(url) {
    const k = keyOf(url);
    return { bin: join(dir, k), meta: join(dir, k + '.type') };
  }

  return {
    get(url) {
      const { bin, meta } = paths(url);
      if (!existsSync(bin)) return null;
      const buf = readFileSync(bin);
      const contentType = existsSync(meta) ? readFileSync(meta, 'utf8') : 'application/octet-stream';
      // touch for LRU (update mtime without rewriting the file)
      try { const now = new Date(); utimesSync(bin, now, now); } catch {}
      return { buf, contentType };
    },
    put(url, buf, contentType) {
      const { bin, meta } = paths(url);
      writeFileSync(bin, buf);
      writeFileSync(meta, contentType || 'application/octet-stream');
      this.prune();
    },
    prune() {
      const files = readdirSync(dir).filter(f => !f.endsWith('.type'))
        .map(f => { const p = join(dir, f); const s = statSync(p); return { p, size: s.size, mtime: s.mtimeMs }; });
      let total = files.reduce((a, f) => a + f.size, 0);
      if (total <= maxBytes) return;
      files.sort((a, b) => a.mtime - b.mtime); // oldest first
      for (const f of files) {
        if (total <= maxBytes) break;
        try { unlinkSync(f.p); unlinkSync(f.p + '.type'); } catch {}
        total -= f.size;
      }
    },
  };
}
