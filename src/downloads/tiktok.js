const { call } = require('../config/orbitx');

// La API puede devolver las URLs como texto o dentro de objetos
// (media: { video, audio, cover }). Aquí todo queda como string.
const asUrl = (v) => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return asUrl(v[0]);
  if (typeof v === 'object') {
    return asUrl(v.url || v.play || v.download || v.download_url || v.src || v.href);
  }
  return '';
};

async function download(url) {
  if (!url || !url.trim()) throw new Error('Falta la URL');
  const data = await call('/tiktok', { url: url.trim() });
  const r = data.result || null;
  if (!r) return null;

  const m = r.media && typeof r.media === 'object' ? r.media : {};
  const media = asUrl(m.video) || asUrl(m.nowm) || asUrl(m.wmplay) || asUrl(r.media) || asUrl(r.video);
  const audio = asUrl(m.audio) || asUrl(m.music) || asUrl(r.audio);
  const cover = asUrl(m.cover) || asUrl(r.cover) || asUrl(r.thumbnail);

  const author =
    typeof r.author === 'string'
      ? r.author
      : (r.author && (r.author.name || r.author.username)) || r.username || '';

  return {
    ...r,
    title: r.title || 'TikTok Video',
    author,
    cover,
    media,
    audio,
    stats: r.stats || {},
  };
}

module.exports = { download };
