export function createUpdates({ library, source }) {
  async function checkOne(slug) {
    const before = library.chaptersOf(slug).length;
    const detail = await source.detail(slug);
    library.follow(detail); // upsert refreshes chapter list (already followed)
    const after = detail.chapters.length;
    return {
      slug,
      name: detail.name,
      newCount: Math.max(0, after - before),
      latest: detail.chapters.at(-1)?.name ?? null,
    };
  }

  async function checkAll(onProgress = () => {}) {
    const slugs = library.listFollowed().map(c => c.slug);
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
