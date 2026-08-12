/**
 * Client Google Drive tối giản (gọi REST bằng fetch, không cần thư viện googleapis).
 *
 * Dùng OAuth refresh token của chính bạn, KHÔNG dùng service account:
 * service account có quota riêng bằng 0 nên không ghi được vào Google One 2TB
 * của tài khoản cá nhân. Với refresh token, file thuộc sở hữu tài khoản bạn và
 * tính vào 2TB đó.
 */

const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function createDrive({
  clientId, clientSecret, refreshToken,
  rootFolderId = 'root',
  fetchFn = fetch,
  now = () => Date.now(),
} = {}) {
  let access = null;         // { token, expiresAt }
  const folderCache = new Map();   // "truyen/slug/12" -> id

  const configured = !!(clientId && clientSecret && refreshToken);

  async function token() {
    if (!configured) throw new Error('Chưa cấu hình Google Drive (thiếu DRIVE_* trong .env)');
    if (access && access.expiresAt > now() + 60_000) return access.token;
    const res = await fetchFn(OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret,
        refresh_token: refreshToken, grant_type: 'refresh_token',
      }).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new Error(`Lấy access token thất bại: ${body.error_description || body.error || res.status}`);
    }
    access = { token: body.access_token, expiresAt: now() + (body.expires_in || 3600) * 1000 };
    return access.token;
  }

  async function api(path, init = {}) {
    const t = await token();
    const res = await fetchFn(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${t}`, ...(init.headers || {}) },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Drive ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res;
  }

  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function findChild(name, parentId) {
    const q = `name='${esc(name)}' and '${esc(parentId)}' in parents and trashed=false`;
    const res = await api(`/files?q=${encodeURIComponent(q)}&fields=files(id,name,size)&pageSize=1`);
    const { files } = await res.json();
    return files?.[0] || null;
  }

  async function createFolder(name, parentId) {
    const res = await api('/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    });
    return (await res.json()).id;
  }

  /** Tạo (hoặc tìm) cây thư mục theo đường dẫn "truyen/slug/chuong" */
  async function ensureFolder(path) {
    const parts = String(path).split('/').filter(Boolean);
    let parentId = rootFolderId;
    let walked = '';
    for (const part of parts) {
      walked = walked ? `${walked}/${part}` : part;
      if (folderCache.has(walked)) { parentId = folderCache.get(walked); continue; }
      const found = await findChild(part, parentId);
      parentId = found ? found.id : await createFolder(part, parentId);
      folderCache.set(walked, parentId);
    }
    return parentId;
  }

  /** Upload multipart; trả { id, size } */
  async function upload({ name, parentId, buffer, mimeType = 'image/jpeg' }) {
    const t = await token();
    const boundary = 'wt' + Math.random().toString(36).slice(2) + 'b';
    const meta = JSON.stringify({ name, parents: [parentId] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
      Buffer.from(buffer),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await fetchFn(`${UPLOAD}?uploadType=multipart&fields=id,size`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Upload Drive ${res.status}: ${txt.slice(0, 200)}`);
    }
    const out = await res.json();
    return { id: out.id, size: Number(out.size) || buffer.byteLength };
  }

  async function download(fileId) {
    const res = await api(`/files/${encodeURIComponent(fileId)}?alt=media`);
    return {
      buf: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') || 'image/jpeg',
    };
  }

  async function remove(fileId) {
    await api(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
  }

  /** Dung lượng Drive: { used, total } byte (total = null nếu không giới hạn) */
  async function quota() {
    const res = await api('/about?fields=storageQuota');
    const q = (await res.json()).storageQuota || {};
    return {
      used: Number(q.usage) || 0,
      total: q.limit ? Number(q.limit) : null,
    };
  }

  return { configured, token, ensureFolder, findChild, upload, download, remove, quota };
}
