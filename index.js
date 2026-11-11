// Servidor único: YouTube (local) + TikTok + Pinterest
require('dotenv').config();
const express = require('express');
const path = require('path');

const apiRoutes = require('./src/routes/api');
const mediaCache = require('./src/cache/media');

const app = express();
// SERVER_PORT primero: es la variable que usa el panel del hosting.
const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
const HOST = '0.0.0.0';

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// ==== LOGGER ====
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.originalUrl.startsWith('/api')) {
      console.log(`→ ${res.statusCode} ${req.method} ${req.originalUrl} (${Date.now() - start}ms)`);
    }
  });
  next();
});

// ==== RATE LIMIT ====
const hits = new Map();
app.use('/api', (req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60 * 1000);
  if (arr.length >= 60) {
    return res.status(429).json({ ok: false, error: 'Demasiadas solicitudes, intenta en un minuto.' });
  }
  arr.push(now);
  hits.set(ip, arr);
  next();
});

app.use('/api', apiRoutes);

// ==== ESTÁTICOS ====
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// ==== ERROR GLOBAL ====
app.use((err, req, res, next) => {
  console.error('💥 Error no manejado:', err);
  res.status(500).json({ ok: false, error: 'Error interno del servidor' });
});

// La caché de miniaturas vive 5 minutos; se revisa cada minuto.
setInterval(() => mediaCache.cleanupOld(5 * 60 * 1000), 60 * 1000);

const server = app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Media Downloader listo → http://localhost:${PORT}`);
  console.log(`   OrbitX API key: ${process.env.ORBITX_API_KEY ? 'configurada' : '❌ no definida (TikTok/Pinterest no funcionarán)'}\n`);
});

// Si el puerto está ocupado no tiene sentido seguir vivo sin escuchar:
// el panel lo vería "activo" pero la web daría mantenimiento.
server.on('error', (err) => {
  console.error(`💥 No se pudo escuchar en ${HOST}:${PORT} — ${err.message}`);
  process.exit(1);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('unhandledRejection', (reason) => console.error('💥 unhandledRejection:', reason));
process.on('uncaughtException', (err) => {
  console.error('💥 uncaughtException:', err);
  process.exit(1);
});
