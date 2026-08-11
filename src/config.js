import 'node:process';

const required = ['SESSION_SECRET'];
for (const k of required) {
  if (!process.env[k]) console.warn(`[config] missing env ${k} — using insecure default`);
}

export const config = {
  PORT: Number(process.env.PORT || 3000),
  DB_PATH: process.env.DB_PATH || './data/app.db',
  CACHE_DIR: process.env.CACHE_DIR || './cache/images',
  SESSION_SECRET: process.env.SESSION_SECRET || 'insecure-dev-secret',
  PASSWORD_HASH: process.env.PASSWORD_HASH || '',
  OTRUYEN_BASE: process.env.OTRUYEN_BASE || 'https://otruyenapi.com/v1/api',
  CDN_IMAGE_BASE: process.env.CDN_IMAGE_BASE || 'https://img.otruyenapi.com',
};
