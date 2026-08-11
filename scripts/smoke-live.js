import { createSource } from '../src/source/otruyen.js';
import { config } from '../src/config.js';

const src = createSource({ base: config.OTRUYEN_BASE, cdnBase: config.CDN_IMAGE_BASE });
let fail = 0;
const check = (name, cond) => { console.log(`${cond ? '✓' : '✗'} ${name}`); if (!cond) fail++; };

const home = await src.home();
check('home returns items', home.items.length > 0);

const search = await src.search('yêu thần ký');
check('search returns items', search.items.length > 0);

const slug = search.items[0].slug;
const detail = await src.detail(slug);
check('detail has chapters', detail.chapters.length > 0);
check('cover url built', detail.thumbUrl.startsWith('http'));

const ch = await src.chapter(detail.chapters[0].apiUrl);
check('chapter has images', ch.images.length > 0);
check('image url built', ch.images[0].url.startsWith('http'));

console.log(fail ? `\n${fail} check(s) FAILED — API shape may have changed.` : '\nAll live checks passed.');
process.exit(fail ? 1 : 0);
