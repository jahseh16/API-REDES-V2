// Prueba E2E de la ruta YouTube 100% local (sin APIs externas)
process.chdir(__dirname)
const fetch = require('node-fetch')
const ytlocal = require('./scrapers/ytlocal.js')
const ytdow2 = require('./scrapers/ytdow2.js')
const URL_YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

function parseDur(d) {
  const p = String(d).split(':').map(Number)
  return p.length === 2 ? p[0] + p[1] / 60 : p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : 0
}

;(async () => {
  let fail = 0
  const ok = (name, cond, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`)
    if (!cond) fail++
  }

  // 1. .play -> info
  const info = await ytlocal.info(URL_YT)
  ok('.play info', info.status === true && !!info.Result, info.Result ? info.Result.titulo.slice(0, 45) : info.error)

  if (info.status) {
    const r = info.Result
    const campos = ['titulo', 'canal', 'vistas', 'duracion', 'fecha', 'url', 'miniatura'].every(k => r[k] !== undefined && r[k] !== '')
    ok('.play campos API-shape', campos)
    ok('.play duracion parseable', parseDur(r.duracion) > 0, `${r.duracion} => ${parseDur(r.duracion).toFixed(2)} min`)

    // url de .play debe ser reutilizable por .ytmp3
    const reuse = await ytlocal.info(r.url)
    ok('.play url reutilizable en .ytmp3', reuse.status === true, r.url)
  }

  // 2. .yts / .ytsearch / .play búsqueda
  const s = await ytlocal.search('rick astley')
  ok('.yts búsqueda', s.status === true && s.Result.length > 0, `${s.Result.length} resultados`)
  if (s.status) {
    const campos = ['titulo', 'canal', 'vistas', 'duracion', 'fecha', 'url', 'miniatura'].every(k => s.Result[0][k] !== undefined)
    ok('.yts campos API-shape', campos, s.Result[0].titulo.slice(0, 45))
  }

  // 3. .mp3 / .ytmp3 (ytdow2 audio)
  const aUrl = await ytdow2(URL_YT, { type: 'audio', format: 'mp3' })
  const aRes = await fetch(aUrl)
  const aBuf = await aRes.buffer()
  const aMagic = aBuf.slice(0, 3).toString('hex')
  ok('.mp3 descarga audio', aRes.status === 200 && aBuf.length > 50000 && (aMagic === '494433' || aMagic.slice(0, 2) === 'ff9'),
    `${aRes.status} ${aBuf.length}B ct=${aRes.headers.get('content-type')} magic=${aMagic}`)

  // 4. .mp4 / .ytmp4 (ytdow2 video con calidad)
  const vUrl = await ytdow2(URL_YT, { type: 'video', quality: '360' })
  const vRes = await fetch(vUrl)
  const vBuf = await vRes.buffer()
  const ftyp = vBuf.slice(4, 8).toString('ascii')
  ok('.mp4 descarga video', vRes.status === 200 && vBuf.length > 100000 && ftyp === 'ftyp',
    `${vRes.status} ${vBuf.length}B ct=${vRes.headers.get('content-type')} ftyp=${ftyp}`)

  // 5. calidad inválida debe rechazarse (valida el endpoint)
  let threw = false
  try { await ytdow2(URL_YT, { type: 'video', quality: '999' }) } catch { threw = true }
  ok('.mp4 calidad inválida rechazada', threw)

  // 6. URL no-YouTube
  const bad = await ytlocal.info('https://example.com/no-yt')
  ok('info URL no-YouTube rechazada', bad.status === false, bad.error)

  console.log(fail === 0 ? '\nTODO OK' : `\n${fail} FALLOS`)
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.log('FATAL', e.message); process.exit(1) })
