// Cliente de la API de OrbitX Space (TikTok, Pinterest y búsqueda de YouTube como respaldo)
const axios = require('axios');

const BASE = process.env.ORBITX_BASE_URL || 'https://api.orbitxspace.com';
const KEY = process.env.ORBITX_API_KEY;

const client = axios.create({
  baseURL: BASE,
  timeout: 60000,
  headers: {
    apikey: KEY,
    'Content-Type': 'application/json',
  },
});

async function call(endpoint, body) {
  try {
    const { data } = await client.post(endpoint, body);
    if (!data || data.status !== true) {
      throw new Error(data?.message || 'La API respondió con status=false');
    }
    return data;
  } catch (err) {
    if (err.code === 'ECONNABORTED') throw new Error('La API tardó demasiado en responder');
    if (err.response?.data?.message) throw new Error(err.response.data.message);
    throw err;
  }
}

module.exports = { call, BASE };
