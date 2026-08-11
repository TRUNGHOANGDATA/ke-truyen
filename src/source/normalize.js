import { cleanSynopsis } from './clean.js';

export function coverUrl(cdnBase, thumbUrl) {
  if (!thumbUrl) return '';
  return `${cdnBase}/uploads/comics/${thumbUrl}`;
}

export function mapListItem(raw, cdnBase) {
  return {
    slug: raw.slug,
    name: raw.name,
    thumbUrl: coverUrl(cdnBase, raw.thumb_url),
    status: raw.status,
    categories: (raw.category || []).map(c => c.name),
    updatedAt: raw.updatedAt,
    latestChapter: raw.chaptersLatest?.[0]?.chapter_name ?? null,
  };
}

export function mapDetail(data) {
  const item = data.item;
  const servers = item.chapters || [];
  const flat = servers.flatMap(s => s.server_data || []);
  const chapters = flat.map((c, i) => ({
    name: c.chapter_name,
    title: c.chapter_title || '',
    apiUrl: c.chapter_api_data,
    order: i,
  }));
  return {
    slug: item.slug,
    name: item.name,
    origin: (item.origin_name || []).join(' · '),
    content: cleanSynopsis(item.content),
    status: item.status,
    thumbUrl: coverUrl(data.APP_DOMAIN_CDN_IMAGE, item.thumb_url),
    categories: (item.category || []).map(c => c.name),
    author: (item.author || []).filter(a => a && a !== 'Đang cập nhật').join(', '),
    updatedAt: item.updatedAt,
    chapters,
  };
}

export function mapChapterImages(data) {
  const { domain_cdn, item } = data;
  const images = (item.chapter_image || []).map(img => ({
    page: img.image_page,
    url: `${domain_cdn}/${item.chapter_path}/${img.image_file}`,
  }));
  return { images };
}
