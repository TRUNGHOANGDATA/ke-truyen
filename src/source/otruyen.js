import { mapListItem, mapDetail, mapChapterImages } from './normalize.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function createSource({ base, cdnBase, fetchFn = fetch, retries = 2, retryDelayMs = 400 }) {
  async function getJson(url) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchFn(url, { headers: { 'user-agent': 'web-truyen/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const body = await res.json();
        if (body.status && body.status !== 'success') throw new Error(`API status ${body.status}`);
        return body.data;
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
      }
    }
    throw lastErr;
  }

  const listShape = (data) => ({
    items: (data.items || []).map(i => mapListItem(i, cdnBase)),
    pagination: data.params?.pagination || null,
  });

  return {
    async home() { return listShape(await getJson(`${base}/home`)); },
    async list(type = 'truyen-moi', page = 1) {
      return listShape(await getJson(`${base}/danh-sach/${type}?page=${page}`));
    },
    async search(keyword) {
      return listShape(await getJson(`${base}/tim-kiem?keyword=${encodeURIComponent(keyword)}`));
    },
    async categories() {
      const data = await getJson(`${base}/the-loai`);
      return (data.items || []).map(c => ({ name: c.name, slug: c.slug }));
    },
    async byCategory(slug, page = 1) {
      return listShape(await getJson(`${base}/the-loai/${slug}?page=${page}`));
    },
    async detail(slug) {
      return mapDetail(await getJson(`${base}/truyen-tranh/${slug}`));
    },
    async chapter(apiUrl) {
      return mapChapterImages(await getJson(apiUrl));
    },
  };
}
