export function createUpdates({ library, source }) {
  async function checkOne(slug) {
    const before = library.chaptersOf(slug).length;
    const detail = await source.detail(slug);
    library.remember(detail); // làm mới mục lục, KHÔNG đổi trạng thái theo dõi
    const after = detail.chapters.length;
    return {
      slug,
      name: detail.name,
      newCount: Math.max(0, after - before),
      latest: detail.chapters.at(-1)?.name ?? null,
    };
  }

  async function checkAll(onProgress = () => {}) {
    // Kiểm tra cả truyện đang theo dõi và truyện đang đọc dở
    const slugs = library.listTracked().map(c => c.slug);
    const results = [];
    for (let i = 0; i < slugs.length; i++) {
      onProgress(i, slugs.length, slugs[i]);
      try { results.push(await checkOne(slugs[i])); }
      catch (err) { results.push({ slug: slugs[i], error: String(err.message || err) }); }
    }
    onProgress(slugs.length, slugs.length, null);
    return results;
  }

  return { checkOne, checkAll };
}
