// Búsqueda de YouTube vía OrbitX. Solo respaldo: la búsqueda local es la principal.
const { call } = require('../config/orbitx');

const normalize = (item) => {
  const author = item.author;
  return {
    titulo: item.title || item.titulo || '',
    canal: typeof author === 'string' ? author : (author && author.name) || item.channel || '',
    vistas: item.views ?? item.vistas ?? '',
    duracion: item.duration || item.timestamp || item.duracion || '',
    fecha: item.ago || item.uploadDate || item.fecha || '',
    url: item.url || (item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : ''),
    miniatura: item.thumbnail || item.cover || item.miniatura || '',
  };
};

async function search(q) {
  if (!q || !q.trim()) throw new Error('Falta el término de búsqueda');
  const data = await call('/search/youtube', { q: q.trim() });
  const items = data.result?.items || data.result?.results || [];
  return items.map(normalize).filter((v) => v.url);
}

module.exports = { search };
