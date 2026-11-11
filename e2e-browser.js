// Prueba E2E en navegador real de la app unificada (sin auth: todo público)
const puppeteer = require('puppeteer-core')
const fs = require('fs')

const BASE = 'http://localhost:3000'
const URL_TEST = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

;(async () => {
  let fails = 0
  const ok = (name, cond, extra = '') => {
    console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' | ' + extra : ''}`)
    if (!cond) fails++
  }

  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/usr/bin/chromium-browser'
  ].filter(Boolean)
  const exe = candidates.find(p => { try { fs.accessSync(p); return true } catch { return false } })
  if (!exe) throw new Error('No se encontró un Chrome/Chromium en el sistema')
  console.log('usando navegador:', exe)

  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 1000 })

  const errors = []
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()) })

  try {
    // 1. La raíz sirve la app
    await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 30000 })
    ok('raíz sirve la app', new URL(page.url()).pathname === '/', page.url())
    ok('título', (await page.title()).includes('MediaDeck'), await page.title())
    ok('estado del servidor', (await page.$eval('#status', el => el.dataset.state)) !== 'down')

    // 2. Las tres plataformas están en la misma página
    const platforms = await page.$$eval('.seg', els => els.map(e => e.dataset.platform))
    ok('plataformas presentes', ['youtube', 'tiktok', 'pinterest'].every(p => platforms.includes(p)), platforms.join(','))

    // 3. URL directa -> info
    await page.type('#yt-url', URL_TEST)
    await page.$eval('#yt-url-form', f => f.requestSubmit())
    await page.waitForFunction(
      () => { const t = document.querySelector('.media-title'); return t && /Rick Astley/.test(t.textContent) },
      { timeout: 60000 }
    )
    const info = await page.$eval('.media-title', el => el.textContent)
    const sub = await page.$eval('.media-sub', el => el.textContent)
    ok('info del video', /Rick Astley/.test(info) && sub.includes('Rick Astley'), sub.trim().slice(0, 60))

    // 4. Descarga de audio con barra de progreso
    await page.click('#yt-dl-audio')
    await page.waitForFunction(
      () => { const l = document.querySelector('#yt-progress .progress-label'); return l && l.textContent.includes('✔') },
      { timeout: 180000 }
    )
    const label = await page.$eval('#yt-progress .progress-label', el => el.textContent)
    ok('descarga audio completa', /✔ .*\.mp3 · \d+\.\d+ MB en \d+(\.\d+)?s/.test(label), label.slice(0, 95))

    // 5. Selectores de calidad/formato disponibles
    const opts = await page.$$eval('#yt-quality option, #yt-format option', els => els.length)
    ok('selectores de descarga', opts >= 12, `${opts} opciones`)

    // 6. Búsqueda por texto
    await page.click('.mode[data-mode="search"]')
    await page.type('#yt-q', 'rick astley')
    await page.$eval('#yt-search-form', f => f.requestSubmit())
    await page.waitForFunction(
      () => document.querySelectorAll('#yt-results .video-card').length > 1,
      { timeout: 60000 }
    )
    const n = await page.$$eval('#yt-results .video-card', els => els.length)
    ok('búsqueda lista resultados', n > 1, `${n} resultados`)

    // 7. "Usar este" carga el video y vuelve a la pestaña de enlace
    await page.click('#yt-results .video-card:nth-child(2) button')
    await page.waitForFunction(
      () => document.querySelector('#yt-mode-url')?.classList.contains('is-active'),
      { timeout: 20000 }
    )
    ok('botón Usar este carga info', (await page.$eval('#yt-url', el => el.value)).includes('youtube'))

    // 8. Sin errores JS
    const realErrors = errors.filter(e => !/favicon|net::ERR|Failed to load resource/i.test(e))
    ok('sin errores JS', realErrors.length === 0, realErrors.slice(0, 3).join(' || ') || 'limpio')

    await page.screenshot({ path: '/tmp/mediadeck_page.png', fullPage: true })
    console.log('screenshot: /tmp/mediadeck_page.png')
  } catch (e) {
    fails++
    console.log('FAIL excepción: ' + e.message)
    console.log('errores JS: ' + JSON.stringify(errors.slice(0, 5)))
    try { await page.screenshot({ path: '/tmp/mediadeck_fail.png', fullPage: true }) } catch {}
  } finally {
    await browser.close()
    console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLOS`)
    process.exit(fails === 0 ? 0 : 1)
  }
})()
