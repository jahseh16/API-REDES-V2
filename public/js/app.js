/* =========================================================
   MediaDeck — lógica del cliente
   ========================================================= */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const YT_QUALITIES = ['144', '240', '360', '720', '1080', '1440', '4k'];
  const YT_AUDIO_FORMATS = ['mp3', 'm4a', 'wav', 'flac', 'ogg'];

  /* ---------------- helpers ---------------- */

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const safeName = (s) =>
    String(s || 'descarga').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80) || 'descarga';

  const mediaSrc = (url) => (url ? `/api/media?url=${encodeURIComponent(url)}` : '');
  const proxyUrl = (url, filename) =>
    `/api/proxy?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;

  function toast(message, type = 'info', ms = 3600) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }, ms);
  }

  async function getJSON(url) {
    const res = await fetch(url);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Respuesta inválida (HTTP ${res.status})`); }
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`Respuesta inválida (HTTP ${res.status})`); }
    if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function clearServerCache() {
    try { await fetch('/api/cache/clear', { method: 'POST' }); } catch {}
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function saveLink(url) {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function filenameFrom(disposition, fallback) {
    if (!disposition) return fallback;
    const star = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (star) { try { return decodeURIComponent(star[1]); } catch {} }
    const quoted = disposition.match(/filename="([^"]+)"/i);
    return quoted ? quoted[1] : fallback;
  }

  function setBusy(btn, label) {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = label;
  }

  function resetBtn(btn, flash) {
    btn.disabled = false;
    btn.textContent = btn.dataset.label || btn.textContent;
    if (flash) {
      btn.classList.add(flash);
      setTimeout(() => btn.classList.remove(flash), 2600);
    }
  }

  /* ---------------- estado del servidor ---------------- */
  async function checkHealth() {
    const box = $('#status');
    const text = $('#status-text');
    try {
      const data = await getJSON('/api/health');
      const ready = data.orbitx === 'configurada';
      box.dataset.state = ready ? 'ok' : 'warn';
      text.textContent = ready ? 'servidor listo' : 'TikTok/Pinterest sin API key';
    } catch {
      box.dataset.state = 'down';
      text.textContent = 'servidor sin respuesta';
    }
  }

  /* ---------------- navegación ---------------- */
  $$('.seg').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.seg').forEach((b) => b.classList.remove('is-active'));
      $$('.panel').forEach((p) => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      $(`#panel-${btn.dataset.platform}`).classList.add('is-active');
    });
  });

  $$('.mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.mode').forEach((b) => b.classList.remove('is-active'));
      $$('.mode-panel').forEach((p) => p.classList.remove('is-active'));
      btn.classList.add('is-active');
      $(`#yt-mode-${btn.dataset.mode}`).classList.add('is-active');
    });
  });

  /* ---------------- progreso de descarga ---------------- */

  function progressBar() {
    const box = $('#yt-progress');
    const bar = $('#yt-progress .bar');
    const label = $('#yt-progress .progress-label');
    const fill = bar.querySelector('span');
    return {
      showIndeterminate(text) {
        box.hidden = false;
        bar.classList.add('is-indeterminate');
        fill.style.width = '35%';
        label.textContent = text;
      },
      update(got, total) {
        bar.classList.remove('is-indeterminate');
        if (total) {
          const pct = Math.min(100, Math.round((got / total) * 100));
          fill.style.width = `${pct}%`;
          label.textContent = `Descargando… ${pct}%`;
        } else {
          fill.style.width = `${Math.min(96, (got / 8388608) * 100)}%`;
          label.textContent = `Descargando… ${(got / 1048576).toFixed(1)} MB`;
        }
      },
      done(text) {
        bar.classList.remove('is-indeterminate');
        fill.style.width = '100%';
        label.textContent = text;
        setTimeout(() => { box.hidden = true; fill.style.width = '0%'; }, 4000);
      },
      fail(text) {
        bar.classList.remove('is-indeterminate');
        fill.style.width = '0%';
        label.textContent = text;
        setTimeout(() => { box.hidden = true; }, 5000);
      },
    };
  }

  async function streamDownload(url, fallbackName, progress) {
    const started = Date.now();
    progress.showIndeterminate('Generando enlace de descarga…');

    const res = await fetch(url);
    const type = res.headers.get('content-type') || '';

    if (!res.ok || type.includes('application/json')) {
      let msg = `HTTP ${res.status}`;
      try { msg = (await res.json()).error || msg; } catch {}
      throw new Error(msg);
    }

    const total = Number(res.headers.get('content-length') || 0);
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      progress.update(got, total);
    }

    const blob = new Blob(chunks, { type: type.split(';')[0] || 'application/octet-stream' });
    const name = filenameFrom(res.headers.get('content-disposition'), fallbackName);
    saveBlob(blob, name);

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    progress.done(`✔ ${name} · ${(blob.size / 1048576).toFixed(1)} MB en ${secs}s`);
    return name;
  }

  /* =========================================================
     YOUTUBE
     ========================================================= */

  function renderYoutubeCard(info, sourceUrl) {
    const target = $('#yt-card');
    const title = info.titulo || 'Video de YouTube';
    const thumb = info.miniatura || '';
    const meta = [info.canal, info.duracion, info.vistas ? `${info.vistas} vistas` : '', info.fecha]
      .filter(Boolean)
      .map((m) => `<span>${esc(m)}</span>`)
      .join('');

    target.innerHTML = `
      <article class="media-card">
        <div class="thumb">
          ${thumb ? `<img src="${esc(mediaSrc(thumb))}" alt="" />` : ''}
        </div>
        <div class="media-body">
          <h2 class="media-title">${esc(title)}</h2>
          <p class="media-sub">${meta}</p>

          <div class="dl-grid">
            <div class="dl-block">
              <label for="yt-quality">Video · MP4</label>
              <div class="dl-row">
                <select id="yt-quality">
                  ${YT_QUALITIES.map((q) => `<option value="${q}"${q === '720' ? ' selected' : ''}>${q === '4k' ? '4K' : q + 'p'}</option>`).join('')}
                </select>
                <button class="btn btn-primary" id="yt-dl-video" type="button">Descargar</button>
              </div>
            </div>
            <div class="dl-block">
              <label for="yt-format">Audio</label>
              <div class="dl-row">
                <select id="yt-format">
                  ${YT_AUDIO_FORMATS.map((f) => `<option value="${f}"${f === 'mp3' ? ' selected' : ''}>${f.toUpperCase()}</option>`).join('')}
                </select>
                <button class="btn" id="yt-dl-audio" type="button">Descargar</button>
              </div>
            </div>
          </div>
        </div>
      </article>
    `;

    const progress = progressBar();

    const run = async (btn, type) => {
      const quality = type === 'video' ? $('#yt-quality').value : $('#yt-format').value;
      const ext = type === 'video' ? 'mp4' : quality;
      setBusy(btn, '⏳ Preparando…');
      try {
        const url = `/api/ytdl/dl?url=${encodeURIComponent(sourceUrl)}&type=${type}&quality=${encodeURIComponent(quality)}`;
        await streamDownload(url, `${safeName(title)}.${ext}`, progress);
        resetBtn(btn, 'is-success');
        toast('Descarga completada', 'success');
      } catch (err) {
        resetBtn(btn, 'is-error');
        progress.fail(`Error: ${err.message}`);
        toast(err.message, 'error', 6000);
      }
    };

    $('#yt-dl-video').addEventListener('click', (e) => run(e.currentTarget, 'video'));
    $('#yt-dl-audio').addEventListener('click', (e) => run(e.currentTarget, 'audio'));
  }

  async function loadYoutubeInfo(url) {
    const target = $('#yt-card');
    target.innerHTML = '<div class="loading">Analizando enlace</div>';
    try {
      const data = await getJSON(`/api/ytdl/info?url=${encodeURIComponent(url)}`);
      if (!data.info) throw new Error(data.error || 'No se pudo obtener la info del video');
      renderYoutubeCard(data.info, url);
    } catch (err) {
      target.innerHTML = `<div class="empty">❌ ${esc(err.message)}</div>`;
      toast(err.message, 'error');
    }
  }

  $('#yt-url-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('#yt-url').value.trim();
    if (url) loadYoutubeInfo(url);
  });

  function renderYoutubeResults(list) {
    const target = $('#yt-results');
    if (!list.length) {
      target.innerHTML = '<div class="empty">Sin resultados</div>';
      return;
    }

    target.innerHTML = list.map((v, i) => `
      <article class="video-card">
        <img src="${esc(mediaSrc(v.miniatura))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div class="vc-body">
          <div class="vc-title">${esc(v.titulo || 'Sin título')}</div>
          <div class="vc-meta">
            ${v.canal ? `<span>${esc(v.canal)}</span>` : ''}
            ${v.duracion ? `<span>${esc(v.duracion)}</span>` : ''}
          </div>
          <button class="btn small" data-i="${i}" type="button">Usar este</button>
        </div>
      </article>
    `).join('');

    $$('#yt-results [data-i]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const video = list[Number(btn.dataset.i)];
        if (!video?.url) return toast('Ese resultado no tiene enlace válido', 'error');
        $('.mode[data-mode="url"]').click();
        $('#yt-url').value = video.url;
        loadYoutubeInfo(video.url);
      });
    });
  }

  $('#yt-search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#yt-q').value.trim();
    if (!q) return;

    $('#yt-card').innerHTML = '';
    $('#yt-results').innerHTML = '<div class="loading">Buscando</div>';
    $('#yt-source').textContent = '';

    try {
      const data = await getJSON(`/api/ytdl/search?q=${encodeURIComponent(q)}`);
      renderYoutubeResults(data.results || []);
      if (data.source === 'respaldo') {
        $('#yt-source').textContent = 'Resultados del servicio de respaldo (OrbitX).';
      }
    } catch (err) {
      $('#yt-results').innerHTML = `<div class="empty">❌ ${esc(err.message)}</div>`;
      toast(err.message, 'error');
    }
  });

  /* =========================================================
     TIKTOK
     ========================================================= */

  function renderTikTok(result) {
    const target = $('#tt-card');
    if (!result) {
      target.innerHTML = '<div class="empty">No se pudo obtener el video</div>';
      return;
    }

    // Acepta tanto URLs planas (backend normalizado) como media: { video, audio, cover }.
    const pick = (v) =>
      !v ? '' : typeof v === 'string' ? v : Array.isArray(v) ? pick(v[0]) : v.url || v.play || v.download_url || '';
    const nested = result.media && typeof result.media === 'object' ? result.media : {};

    const title = result.title || 'Video de TikTok';
    const author = typeof result.author === 'string' ? result.author : result.author?.name || result.author?.username || '';
    const cover = pick(result.cover) || pick(nested.cover) || pick(result.thumbnail);
    const videoUrl = pick(result.media) || pick(nested.video) || pick(nested.nowm);
    const audioUrl = pick(result.audio) || pick(nested.audio) || pick(nested.music);
    const hasVideo = !!videoUrl;
    const hasAudio = !!audioUrl;
    const base = safeName(title);

    target.innerHTML = `
      <article class="media-card">
        <div class="thumb portrait">
          ${cover ? `<img src="${esc(mediaSrc(cover))}" alt="" />` : ''}
        </div>
        <div class="media-body">
          <h2 class="media-title">${esc(title)}</h2>
          <p class="media-sub">
            ${author ? `<span>@${esc(author.replace(/^@/, ''))}</span>` : ''}
            <span>TikTok</span>
          </p>
          <div class="dl-grid">
            ${hasVideo ? `
              <div class="dl-block">
                <label>Video · sin marca de agua</label>
                <button class="btn btn-primary" id="tt-dl-video" type="button">Descargar MP4</button>
              </div>` : ''}
            ${hasAudio ? `
              <div class="dl-block">
                <label>Audio</label>
                <button class="btn" id="tt-dl-audio" type="button">Descargar MP3</button>
              </div>` : ''}
          </div>
        </div>
      </article>
    `;

    if (hasVideo) {
      $('#tt-dl-video').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        setBusy(btn, '⏳ Iniciando…');
        saveLink(proxyUrl(videoUrl, `${base}.mp4`));
        resetBtn(btn, 'is-success');
        toast('Descarga de video iniciada', 'success');
      });
    }

    if (hasAudio) {
      $('#tt-dl-audio').addEventListener('click', (e) => {
        const btn = e.currentTarget;
        setBusy(btn, '⏳ Iniciando…');
        saveLink(proxyUrl(audioUrl, `${base}.mp3`));
        resetBtn(btn, 'is-success');
        toast('Descarga de audio iniciada', 'success');
      });
    }
  }

  $('#tt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('#tt-url').value.trim();
    const target = $('#tt-card');
    if (!url) return;

    target.innerHTML = '<div class="loading">Analizando enlace</div>';
    await clearServerCache();

    try {
      const data = await postJSON('/api/tiktok/download', { url });
      renderTikTok(data.result);
    } catch (err) {
      target.innerHTML = `<div class="empty">❌ ${esc(err.message)}</div>`;
      toast(err.message, 'error', 6000);
    }
  });

  /* =========================================================
     PINTEREST
     ========================================================= */

  $('#pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#pin-q').value.trim();
    const target = $('#pin-results');
    if (!q) return;

    target.innerHTML = '<div class="loading">Buscando</div>';
    await clearServerCache();

    try {
      const data = await getJSON(`/api/pinterest/search?q=${encodeURIComponent(q)}`);
      const results = (data.results || []).filter(
        (item) => item.image_large_url || item.image_medium_url || item.image_small_url
      );

      if (!results.length) {
        target.innerHTML = '<div class="empty">Sin resultados</div>';
        return;
      }

      target.innerHTML = results.map((item, i) => {
        const preview = item.image_medium_url || item.image_small_url || item.image_large_url;
        const full = item.image_large_url || item.image_medium_url || item.image_small_url;
        const title = item.title || `Pinterest ${i + 1}`;
        return `
          <div class="pin" data-src="${esc(full)}" data-name="${esc(safeName(title))}" tabindex="0">
            <img src="${esc(mediaSrc(preview))}" alt="${esc(title)}" loading="lazy" onerror="this.style.visibility='hidden'" />
            <div class="pin-overlay"><button class="btn btn-primary small" type="button">Descargar</button></div>
          </div>
        `;
      }).join('');

      $$('#pin-results .pin').forEach((pin) => {
        const download = () => {
          const src = pin.dataset.src;
          if (!src) return toast('Imagen sin URL', 'error');
          saveLink(proxyUrl(src, `${pin.dataset.name}.jpg`));
          toast('Descarga de imagen iniciada', 'success');
        };
        pin.addEventListener('click', download);
        pin.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); download(); }
        });
      });
    } catch (err) {
      target.innerHTML = `<div class="empty">❌ ${esc(err.message)}</div>`;
      toast(err.message, 'error', 6000);
    }
  });

  /* ---------------- init ---------------- */
  $('#year').textContent = new Date().getFullYear();
  checkHealth();
})();
