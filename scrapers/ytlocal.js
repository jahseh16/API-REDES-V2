/*
 * YouTube local (reemplaza a la API caída api-nv.ultraplus.click)
 *
 * Devuelve exactamente la misma forma de respuesta que la API original:
 *   info(q)    -> { status, Result: { titulo, canal, vistas, duracion, fecha, url, miniatura } }
 *   search(q)  -> { status, Result: [ ...mismo objeto... ] }
 */
const yts = require('yt-search')

function extractVideoId(input) {
  const raw = String(input || '').trim()
  if (!raw) return null
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw

  try {
    const u = new URL(raw)
    const host = u.hostname.replace(/^www\./, '')

    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0]
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const fromQuery = u.searchParams.get('v')
      if (fromQuery && /^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery

      const segs = u.pathname.split('/').filter(Boolean)
      const idx = segs.findIndex(s => ['shorts', 'embed', 'live', 'v'].includes(s.toLowerCase()))
      const id = idx !== -1 ? segs[idx + 1] : null
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    }
  } catch {}

  const m = raw.match(/[?&]v=([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}

function toSeconds(video) {
  if (video && typeof video.seconds === 'number' && isFinite(video.seconds)) return video.seconds
  const t = (video && video.timestamp) || ''
  if (!t) return 0
  const parts = String(t).split(':').map(Number)
  if (parts.some(isNaN)) return 0
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

function views(n) {
  if (n === null || n === undefined || n === '') return '0'
  if (typeof n === 'number') {
    try { return n.toLocaleString('es') } catch { return String(n) }
  }
  return String(n)
}

function normalize(v) {
  if (!v) return null
  const author = v.author
  const canal = typeof author === 'string' ? author : (author && author.name) || ''
  const thumbnail = v.thumbnail || v.image || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
  const segundos = toSeconds(v)
  const duracion = v.timestamp || `${Math.floor(segundos / 3600)}:${String(Math.floor((segundos % 3600) / 60)).padStart(2, '0')}:${String(segundos % 60).padStart(2, '0')}`

  return {
    titulo: v.title || '',
    canal,
    vistas: views(v.views),
    duracion,
    fecha: v.ago || v.uploadDate || '',
    url: v.url || (v.videoId ? `https://www.youtube.com/watch?v=${v.videoId}` : ''),
    miniatura: thumbnail,
    videoId: v.videoId || '',
    segundos
  }
}

// info(url) -> { status, Result }
async function info(url) {
  try {
    const id = extractVideoId(url)
    if (!id) return { status: false, error: 'URL de YouTube no válida' }

    const v = await yts({ videoId: id })
    const r = normalize(v)
    if (!r || !r.titulo) return { status: false, error: 'Video no encontrado' }
    return { status: true, Result: r }
  } catch (e) {
    return { status: false, error: e.message }
  }
}

// search(q) -> { status, Result: [] }
async function search(q, limit = 25) {
  try {
    const query = String(q || '').trim()
    if (!query) return { status: false, Result: [], error: 'Sin consulta' }

    const r = await yts(query)
    const list = Array.isArray(r && r.videos) ? r.videos : []
    const Result = list.slice(0, limit).map(normalize).filter(x => x && x.titulo)

    if (!Result.length) return { status: false, Result: [], error: 'Sin resultados' }
    return { status: true, Result }
  } catch (e) {
    return { status: false, Result: [], error: e.message }
  }
}

module.exports = { info, search, extractVideoId }
