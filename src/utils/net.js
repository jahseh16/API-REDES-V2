/*
 * Guardia de URLs: evita que /api/proxy y /api/media se usen para
 * alcanzar la red interna del servidor (SSRF) o dominios arbitrarios.
 */
const net = require('net');
const dns = require('dns').promises;
const axios = require('axios');

// Dominios que la app necesita de verdad. Se pueden ampliar con ALLOWED_HOSTS.
const DEFAULT_HOSTS = [
  // YouTube
  'youtube.com', 'youtu.be', 'ytimg.com', 'ggpht.com', 'googlevideo.com',
  // TikTok
  'tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com',
  'tiktokv.com', 'ibytedtos.com', 'byteoversea.com', 'ttwstatic.com',
  // Pinterest
  'pinimg.com', 'pinterest.com',
  // Descarga de YouTube
  'savenow.to',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const extraHosts = () =>
  String(process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

const allowedHosts = () => [...DEFAULT_HOSTS, ...extraHosts()];

function hostAllowed(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return allowedHosts().some((domain) => host === domain || host.endsWith('.' + domain));
}

function ipIsPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||            // link-local / metadata cloud
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||  // CGNAT
      a >= 224                               // multicast / reservado
    );
  }

  const v = String(ip).toLowerCase().split('%')[0];
  if (v.startsWith('::ffff:')) return ipIsPrivate(v.slice(7));
  return (
    v === '::1' || v === '::' ||
    v.startsWith('fc') || v.startsWith('fd') ||  // ULA
    v.startsWith('fe80') ||                        // link-local
    v.startsWith('ff')                            // multicast
  );
}

// Valida esquema, dominio permitido y que resuelva solo a IPs públicas.
async function validateUrl(raw, { allowHosts = true } = {}) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    throw new HttpError(400, 'URL inválida');
  }

  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'Solo se permiten enlaces http/https');
  if (url.username || url.password) throw new HttpError(400, 'URL no permitida');
  if (allowHosts && !hostAllowed(url.hostname)) {
    throw new HttpError(403, 'Ese dominio no está permitido para descarga');
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  if (net.isIP(host)) {
    if (ipIsPrivate(host)) throw new HttpError(403, 'Destino no permitido');
    return url;
  }

  if (/(^|\.)(localhost|local|internal)$/i.test(host)) {
    throw new HttpError(403, 'Destino no permitido');
  }

  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch {
    throw new HttpError(502, 'No se pudo resolver el dominio');
  }

  if (!addresses.length) throw new HttpError(502, 'No se pudo resolver el dominio');
  if (addresses.some(({ address }) => ipIsPrivate(address))) {
    throw new HttpError(403, 'Destino no permitido');
  }

  return url;
}

/*
 * Abre un stream remoto siguiendo redirecciones de una en una,
 * validando cada salto (una redirección no puede saltarse la whitelist).
 */
async function openStream(rawUrl, { headers = {}, timeout = 120000, maxHops = 4, referer } = {}) {
  let current = String(rawUrl);

  for (let hop = 0; hop <= maxHops; hop++) {
    const url = await validateUrl(current);
    const reqHeaders = { 'User-Agent': UA, Accept: '*/*', ...headers };
    if (referer) reqHeaders.Referer = referer;

    const upstream = await axios.get(url.toString(), {
      responseType: 'stream',
      timeout,
      maxRedirects: 0,
      validateStatus: () => true,
      headers: reqHeaders,
    });

    const location = upstream.headers?.location;
    if ([301, 302, 303, 307, 308].includes(upstream.status) && location) {
      try { upstream.data.destroy(); } catch {}
      current = new URL(location, url).toString();
      continue;
    }

    if (upstream.status < 200 || upstream.status >= 300) {
      try { upstream.data.destroy(); } catch {}
      throw new HttpError(502, `El servidor remoto respondió ${upstream.status}`);
    }

    return { upstream, finalUrl: url.toString() };
  }

  throw new HttpError(502, 'El enlace remoto redirige demasiadas veces');
}

module.exports = { HttpError, validateUrl, openStream, hostAllowed, UA };
