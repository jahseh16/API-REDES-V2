const { call } = require('../config/orbitx');

async function download(url) {
  if (!url || !url.trim()) throw new Error('Falta la URL');
  const data = await call('/tiktok', { url: url.trim() });
  return data.result || null;
}

module.exports = { download };
