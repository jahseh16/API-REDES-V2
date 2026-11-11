const express = require('express');
const fs = require('fs');
const nodeFetch = require('node-fetch');
const ytlocal = require('../../scrapers/ytlocal');
const yt2dow = require('../../scrapers/ytdow2');
const tiktok = require('../downloads/tiktok');
const pinterest = require('../downloads/pinterest');
const youtubeSearchFallback = require('../downloads/youtubeSearch');
const mediaCache = require('../cache/media');
const { openStream, validateUrl } = require('../utils/net');
const downloadSlots = require('../utils/limit');

const router = express.Router();

const YT_QUALITIES = ['144', '240', '360', '720', '1080', '1440', '4k'];
const YT_AUDIO_FORMATS = ['mp3', 'm4a', 'webm', 'aacc', 'flac', 'apus', 'ogg', 'wav'];

const withTimeout = (p, ms, label) => {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(label)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
};

const safeName = (s) => String(s || '')
  .replace(/[\\/:*?"<>|\r\n]/g, '_')
  .slice(0, 120)
  .trim() || 'descarga';

const isUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

const BUSY_MSG = 'El servidor está ocupado con otras descargas. Intenta de nuevo en unos segundos.';

const friendlyError = (e) => {
  const msg = String((e && e.message) || '');
  if (/Tiempo agotado|timeout|timed out/i.test(msg)) {
    return { status: 504, error: 'El servicio de descarga tardó demasiado. Intenta de nuevo en unos segundos.' };
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|network/i.test(msg)) {
    return { status: 502, error: 'No se pudo conectar con el servicio de descarga. Revisa la conexión del servidor.' };
  }
  return { status: e.status || 500, error: msg || 'Error inesperado' };
};

// Traduce fallos de OrbitX a mensajes entendibles para el usuario.
const isBadInput = (e) => /^Falta (la URL|el t[eé]rmino)/i.test(String((e && e.message) || ''));

const orbitxError = (e, name) => {
  if (!process.env.ORBITX_API_KEY) return `${name}: falta ORBITX_API_KEY en el servidor.`;
  const s = e && e.response && e.response.status;
  if (s === 403) return `${name}: la API rechazó la petición (posible bloqueo de Cloudflare). Intenta más tarde.`;
  if (s === 429) return `${name}: demasiadas solicitudes a la API. Espera un momento.`;
  if (s >= 500) return `${name}: la API está caída (HTTP ${s}). Intenta más tarde.`;
  if (s) return `${name}: la API respondió HTTP ${s}.`;
  if (isBadInput(e)) return (e && e.message) || `${name}: datos incompletos.`;
  return `${name}: ${(e && e.message) || 'error desconocido'}`;
};

/* ================= ESTADO ================= */

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    orbitx: process.env.ORBITX_API_KEY ? 'configurada' : 'sin API key',
  });
});

/* ================= YOUTUBE (local) ================= */

router.get('/ytdl/info', async (req, res) => {
  const url = String(req.query.url || '').trim();
  if (!url) return res.status(400).json({ ok: false, error: 'Falta url' });
  const r = await ytlocal.info(url);
  res.json({ ok: !!r.status, info: r.Result || null, error: r.error || null });
});

// Búsqueda: local primero, OrbitX solo si la local no devuelve nada
router.get('/ytdl/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ ok: false, error: 'Falta q' });

  const local = await ytlocal.search(q, 30);
  if (local.status && local.Result?.length) {
    return res.json({ ok: true, source: 'local', results: local.Result });
  }

  try {
    const results = await youtubeSearchFallback.search(q);
    res.json({ ok: true, source: 'respaldo', results, error: local.error || null });
  } catch (e) {
    res.json({ ok: true, source: 'local', results: [], error: e.message });
  }
});

// Descarga: genera el enlace con ytdow2 y lo hace streaming al navegador
router.get('/ytdl/dl', async (req, res) => {
  const started = Date.now();
  const slot = downloadSlots.acquire(req.ip);
  if (!slot.ok) {
    res.set('Retry-After', String(slot.retryAfter));
    return res.status(503).json({ ok: false, error: BUSY_MSG });
  }
  res.on('close', slot.release);

  try {
    const url = String(req.query.url || '').trim();
    const type = req.query.type === 'video' ? 'video' : 'audio';
    const quality = String(req.query.quality || (type === 'video' ? '720' : 'mp3')).toLowerCase();

    if (!url) return res.status(400).json({ ok: false, error: 'Falta url' });
    if (type === 'video' && !YT_QUALITIES.includes(quality)) {
      return res.status(400).json({ ok: false, error: 'Calidad no válida: usa ' + YT_QUALITIES.join(', ') });
    }
    if (type === 'audio' && !YT_AUDIO_FORMATS.includes(quality)) {
      return res.status(400).json({ ok: false, error: 'Formato de audio no válido: usa ' + YT_AUDIO_FORMATS.join(', ') });
    }

    const opts = type === 'video' ? { type: 'video', quality } : { type: 'audio', format: quality };

    // info y descarga en paralelo: la info solo sirve para nombrar el archivo
    const [info, direct] = await Promise.all([
      ytlocal.info(url).catch(() => null),
      withTimeout(yt2dow(url, opts), 120000, 'Tiempo agotado al generar el enlace de descarga'),
    ]);

    const upstream = await nodeFetch(direct);
    if (!upstream.ok) {
      return res.status(502).json({
        ok: false,
        error: `El proveedor de descarga de YouTube respondió ${upstream.status}. Prueba otro formato o intenta más tarde.`,
      });
    }

    const ext = type === 'video' ? 'mp4' : (quality === 'mp3' ? 'mp3' : quality);
    const title = (info && info.status && info.Result && info.Result.titulo) || `youtube_${quality}`;
    const filename = `${safeName(title)}.${ext}`;
    const asciiName = filename.replace(/[^\x20-\x7E]/g, '_');

    res.status(200);
    res.set({
      'Content-Type': upstream.headers.get('content-type') || (type === 'video' ? 'video/mp4' : 'audio/mpeg'),
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
      'X-Download-Time-Ms': String(Date.now() - started),
    });
    const clen = upstream.headers.get('content-length');
    if (clen) res.set('Content-Length', clen);

    upstream.body.pipe(res);
    res.on('close', () => { try { upstream.body.destroy(); } catch {} });
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch {}; return; }
    const { status, error } = friendlyError(e);
    console.error('❌ [ytdl/dl]', e.message);
    res.status(status).json({ ok: false, error });
  }
});

/* ================= TIKTOK ================= */

router.post('/tiktok/download', async (req, res) => {
  try {
    const result = await tiktok.download(req.body?.url);
    res.json({ ok: true, result });
  } catch (e) {
    console.error('❌ [tiktok]', e.message);
    res.status(isBadInput(e) ? 400 : 502).json({ ok: false, error: orbitxError(e, 'TikTok') });
  }
});

/* ================= PINTEREST ================= */

router.get('/pinterest/search', async (req, res) => {
  try {
    const results = await pinterest.search(req.query.q);
    res.json({ ok: true, results });
  } catch (e) {
    console.error('❌ [pinterest]', e.message);
    res.status(isBadInput(e) ? 400 : 502).json({ ok: false, error: orbitxError(e, 'Pinterest') });
  }
});

/* ================= PROXY DE DESCARGA ================= */

router.get('/proxy', async (req, res) => {
  const { url, filename, mime } = req.query;

  if (!isUrl(url)) return res.status(400).type('text').send('URL inválida');

  const slot = downloadSlots.acquire(req.ip);
  if (!slot.ok) {
    res.set('Retry-After', String(slot.retryAfter));
    return res.status(503).type('text').send('Servidor ocupado con otras descargas. Espera unos segundos e intenta de nuevo.');
  }
  res.on('close', slot.release);

  try {
    const { upstream } = await openStream(url, { timeout: 120000 });

    const safe = String(filename || 'download').replace(/[^\w.\-]+/g, '_').slice(0, 120);
    res.setHeader('Content-Type', mime || upstream.headers['content-type'] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);

    upstream.data.pipe(res);
    upstream.data.on('error', () => res.end());
  } catch (err) {
    console.error('❌ Proxy:', err.message);
    if (res.headersSent) { try { res.end(); } catch {}; return; }
    res.status(err.status || 502).type('text').send(err.message || 'No se pudo descargar el archivo');
  }
});

/* ================= MEDIA (imágenes/videos vía caché) ================= */

router.get('/media', async (req, res) => {
  const { url } = req.query;
  if (!isUrl(url)) return res.status(400).type('text').send('URL inválida');

  try {
    // Validar SIEMPRE, incluso si ya está en caché.
    await validateUrl(url);
    const { path: filePath, contentType } = await mediaCache.get(url);
    const ext = filePath.split('.').pop().toLowerCase();
    const mime = contentType || {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
      gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm',
    }[ext] || 'application/octet-stream';

    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=300');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('❌ /api/media error:', err.message);
    if (res.headersSent) { try { res.end(); } catch {}; return; }
    res.status(err.status || 502).type('text').send(err.message || 'No se pudo obtener el media');
  }
});

router.post('/cache/clear', (req, res) => {
  res.json({ ok: true, deleted: mediaCache.clearAll() });
});

module.exports = router;
