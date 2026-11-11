const { call } = require('../config/orbitx');

async function search(q) {
  if (!q || !q.trim()) throw new Error('Falta el término de búsqueda');
  const data = await call('/pinterestimg', { q: q.trim() });
  return data.result?.results || data.result?.items || [];
}

module.exports = { search };
