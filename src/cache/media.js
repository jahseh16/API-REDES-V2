const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openStream } = require('../utils/net');

const CACHE_DIR = path.join(__dirname, '..', '..', 'cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const keyFor = (url) => crypto.createHash('md5').update(url).digest('hex');
const pathFor = (url) => path.join(CACHE_DIR, keyFor(url));

const EXT_BY_MIME = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm',
};

// Descarga (si no está) y devuelve la ruta local
async function get(url) {
  const p = pathFor(url);
  const existing = fs.readdirSync(CACHE_DIR).find((f) => f.startsWith(keyFor(url)));
  if (existing) return { path: path.join(CACHE_DIR, existing), cached: true };

  const host = new URL(url).origin;
  const { upstream: res } = await openStream(url, {
    timeout: 30000,
    referer: host + '/',
    headers: { Accept: 'image/avif,image/webp,image/*,video/*,*/*;q=0.8' },
  });

  const ct = (res.headers['content-type'] || '').split(';')[0].trim();
  const ext = EXT_BY_MIME[ct] || '.bin';
  const finalPath = p + ext;
  const tmp = finalPath + '.tmp';

  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(tmp);
    res.data.pipe(w);
    res.data.on('error', reject);
    w.on('finish', resolve);
    w.on('error', reject);
  });
  fs.renameSync(tmp, finalPath);

  return { path: finalPath, cached: false, contentType: ct };
}

function clearAll() {
  let n = 0;
  try {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); n++; } catch {}
    }
  } catch (e) { console.error('clearAll err:', e.message); }
  return n;
}

function cleanupOld(maxAgeMs = 5 * 60 * 1000) {
  const now = Date.now();
  let n = 0;
  try {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      try {
        const p = path.join(CACHE_DIR, f);
        if (now - fs.statSync(p).mtimeMs > maxAgeMs) { fs.unlinkSync(p); n++; }
      } catch {}
    }
  } catch {}
  return n;
}

module.exports = { get, clearAll, cleanupOld, CACHE_DIR };
