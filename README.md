# MediaDeck — YouTube · TikTok · Pinterest

App web única para **descargar audio/video de YouTube** (100% local, sin APIs externas) y **descargar videos de TikTok e imágenes de Pinterest** (vía API de OrbitX Space).

## Arrancar

```bash
npm install --omit=dev
cp .env.example .env      # añade tu ORBITX_API_KEY
npm start
```

Abre **http://localhost:3000**.

En hosting, el puerto lo define `SERVER_PORT` (tiene prioridad sobre `PORT`); el servidor escucha siempre en `0.0.0.0`. Ejemplo: `SERVER_PORT=25545 npm start`.

Sin `ORBITX_API_KEY` todo funciona excepto TikTok y Pinterest.

## Estructura

| Pieza | Rol |
|---|---|
| `index.js` | Servidor Express: estáticos, rate limit, monta `/api`, limpia caché. |
| `src/routes/api.js` | Todos los endpoints (YouTube, TikTok, Pinterest, proxy, media). |
| `scrapers/ytlocal.js` | Info y búsqueda de YouTube vía `yt-search` (local). |
| `scrapers/ytdow2.js` | Genera el enlace de descarga de YouTube (audio o video). |
| `src/downloads/tiktok.js` | Descarga de TikTok (OrbitX). |
| `src/downloads/pinterest.js` | Búsqueda de imágenes en Pinterest (OrbitX). |
| `src/downloads/youtubeSearch.js` | Búsqueda de YouTube **de respaldo** (solo si la local falla). |
| `src/config/orbitx.js` | Cliente HTTP de OrbitX. |
| `src/cache/media.js` | Caché en disco de miniaturas/imágenes para servirlas por `/api/media`. |
| `public/index.html` | Interfaz única (una sola página). |
| `public/css/styles.css` | Estilos. |
| `public/js/app.js` | Lógica del cliente. |

## Endpoints

```
GET  /api/health
GET  /api/ytdl/info?url=<youtube-url>
GET  /api/ytdl/search?q=<texto>            # local; cae al respaldo OrbitX si no hay resultados
GET  /api/ytdl/dl?url=<url>&type=audio|video&quality=<mp3|720|...>

POST /api/tiktok/download                  # body: { url }
GET  /api/pinterest/search?q=<texto>

GET  /api/proxy?url=<url>&filename=<nombre>   # descarga con nombre de archivo
GET  /api/media?url=<url>                     # sirve miniaturas/imágenes desde caché
POST /api/cache/clear
```

`/api/ytdl/dl` devuelve el archivo con `Content-Disposition`, así que el navegador lo guarda con el título del video.

## Notas

- **YouTube** no necesita claves ni servidor externo: funciona en local.
- **TikTok y Pinterest** dependen de `api.orbitxspace.com`. Si esa API devuelve `403` / `Just a moment...`, es Cloudflare bloqueando la IP desde la que se ejecuta el servidor (por eso conviene desplegarlo en un servidor, como el original de `api-redes`).
- **Seguridad:** `/api/proxy` y `/api/media` solo aceptan dominios de la whitelist (YouTube, TikTok, Pinterest, savenow) y rechazan IPs privadas/loopback, incluso tras redirecciones. Amplía con `ALLOWED_HOSTS`.
- **Cupos de descarga:** máximo `MAX_CONCURRENT_DOWNLOADS` (3) a la vez en total y `MAX_CONCURRENT_PER_IP` (2) por IP; al llenarse responde `503` con un mensaje claro.
- Formatos de audio válidos: `mp3`, `m4a`, `webm`, `flac`, `ogg`, `wav` (y los extra de `ytdow2`).
- Calidades de video: `144`, `240`, `360`, `720`, `1080`, `1440`, `4k`.

## Tests

```bash
npm test              # e2e-yt.js: scrapers + descargas reales
npm run test:browser  # e2e-browser.js: recorre la UI en Chromium (requiere npm start)
```
