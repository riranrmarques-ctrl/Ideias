function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function progressFor(videoId) {
  try {
    const raw = localStorage.getItem('wf_progress_' + videoId);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ---------- Hero rotativo: toca as capas verticais em sequência ----------
let heroReels = [];
let heroIndex = 0;
let heroHls = null;

function heroMarkup(video) {
  return `
    <section class="hero">
      <video class="hero-bg" id="heroVideo" muted autoplay playsinline></video>
      <div class="hero-content">
        <div class="category">${video.category}</div>
        <h1 id="heroTitle">${video.title}</h1>
        <p id="heroDesc">${video.description || ''}</p>
        <a class="btn btn-primary" id="heroCta" href="/watch.html?id=${video.id}">▶ Assistir completo</a>
      </div>
      <div class="hero-dots" id="heroDots"></div>
    </section>
  `;
}

function renderHeroDots() {
  const dots = document.getElementById('heroDots');
  if (!dots || heroReels.length < 2) { if (dots) dots.innerHTML = ''; return; }
  dots.innerHTML = heroReels.map((_, i) =>
    `<button class="${i === heroIndex ? 'active' : ''}" onclick="window.__heroGoTo(${i})"></button>`
  ).join('');
}

function loadHeroVideo(index) {
  heroIndex = index;
  const video = heroReels[heroIndex];
  const videoEl = document.getElementById('heroVideo');
  document.getElementById('heroTitle').textContent = video.title;
  document.getElementById('heroDesc').textContent = video.description || '';
  document.getElementById('heroCta').href = `/watch.html?id=${video.id}`;
  renderHeroDots();

  if (heroHls) { heroHls.destroy(); heroHls = null; }

  if (window.Hls && Hls.isSupported()) {
    heroHls = new Hls();
    heroHls.loadSource(video.hls_url);
    heroHls.attachMedia(videoEl);
    heroHls.on(Hls.Events.MANIFEST_PARSED, () => videoEl.play().catch(() => {}));
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = video.hls_url;
    videoEl.play().catch(() => {});
  }
}

window.__heroGoTo = (i) => loadHeroVideo(i);

function advanceHero() {
  const next = (heroIndex + 1) % heroReels.length;
  loadHeroVideo(next);
}

function renderHero(reelVideos, fallbackVideo) {
  const section = document.getElementById('heroSection');

  // Sem capas verticais prontas: usa a mesma estrutura, mas com imagem estática (comportamento original)
  if (!reelVideos.length) {
    if (!fallbackVideo) { section.innerHTML = ''; return; }
    section.innerHTML = `
      <section class="hero" style="background-image:url('${fallbackVideo.poster_url || ''}'); background-size:cover; background-position:center;">
        <div class="hero-content">
          <div class="category">${fallbackVideo.category}</div>
          <h1>${fallbackVideo.title}</h1>
          <p>${fallbackVideo.description || ''}</p>
          <a class="btn btn-primary" href="/watch.html?id=${fallbackVideo.id}">▶ Assistir</a>
        </div>
      </section>
    `;
    return;
  }

  heroReels = reelVideos;
  section.innerHTML = heroMarkup(reelVideos[0]);
  const videoEl = document.getElementById('heroVideo');
  videoEl.addEventListener('ended', advanceHero);
  loadHeroVideo(0);
}

// ---------- Filmes horizontais (carrosséis por categoria) ----------
function cardHTML(video) {
  const isReady = video.status === 'ready';
  const progress = progressFor(video.id);
  let progressBar = '';
  if (progress && progress.pct > 3 && progress.pct < 95) {
    progressBar = `<div style="height:3px;background:rgba(255,255,255,0.15);margin-top:6px;border-radius:2px;overflow:hidden;">
      <div style="height:100%;width:${progress.pct}%;background:var(--gold);"></div></div>`;
  }
  return `
    <a class="card" href="${isReady ? `/watch.html?id=${video.id}` : '#'}" ${isReady ? '' : 'onclick="return false;"'}>
      <div class="card-thumb" style="background-image:url('${video.poster_url || ''}')">
        ${video.max_quality ? `<span class="badge">${video.max_quality}</span>` : ''}
        ${!isReady ? `<div class="processing">${video.status.startsWith('processing') ? 'Processando ' + video.status.split(':')[1] : 'Aguardando processamento'}</div>` : ''}
      </div>
      <div class="card-title">${video.title}</div>
      <div class="card-meta">${formatDuration(video.duration_seconds)}</div>
      ${progressBar}
    </a>
  `;
}

function albumCardHTML(album) {
  return `
    <a class="card" href="/album.html?id=${album.id}">
      <div class="card-thumb" style="background-image:url('${album.cover_url || ''}')">
        <span class="badge">📷 Álbum</span>
      </div>
      <div class="card-title">${album.title}</div>
    </a>
  `;
}

function contractCardHTML(contract) {
  const isSigned = contract.status === 'signed';
  return `
    <a class="card" href="/contract.html?id=${contract.id}">
      <div class="card-thumb" style="background:var(--surface); display:flex; align-items:center; justify-content:center; font-size:34px;">
        📄
        <span class="badge" style="background:${isSigned ? 'rgba(90,160,90,0.85)' : 'rgba(201,161,90,0.85)'}; color:#0d1420;">${isSigned ? 'Assinado' : 'Pendente'}</span>
      </div>
      <div class="card-title">${contract.title}</div>
    </a>
  `;
}

async function loadCatalog() {
  const [videosRes, albumsRes, contractsRes] = await Promise.all([
    fetch('/api/videos'),
    fetch('/api/albums'),
    fetch('/api/contracts/mine')
  ]);
  if (!videosRes.ok) return;
  const videos = await videosRes.json();
  const albums = albumsRes.ok ? await albumsRes.json() : [];
  const contracts = contractsRes.ok ? await contractsRes.json() : [];
  const rowsEl = document.getElementById('rows');

  const readyReels = videos.filter(v => v.orientation === 'vertical' && v.status === 'ready');
  const filmVideos = videos.filter(v => v.orientation !== 'vertical');
  const readyFilms = filmVideos.filter(v => v.status === 'ready');

  renderHero(readyReels, readyFilms[0] || filmVideos[0]);

  if (filmVideos.length === 0 && albums.length === 0 && contracts.length === 0) {
    rowsEl.innerHTML = readyReels.length ? '' : `<div class="empty-state">
      <h2>Sua entrega ainda não chegou por aqui</h2>
      <p>Assim que seu filme ou álbum for publicado pelo fotógrafo, ele aparece nesta página.</p>
    </div>`;
    return;
  }

  let html = '';

  if (contracts.length) {
    html += `
      <div class="row">
        <div class="row-header"><h2>Contrato</h2></div>
        <div class="row-track">${contracts.map(contractCardHTML).join('')}</div>
      </div>
    `;
  }

  if (filmVideos.length) {
    const byCategory = {};
    for (const v of filmVideos) { (byCategory[v.category] ||= []).push(v); }
    html += Object.entries(byCategory).map(([category, list]) => `
      <div class="row">
        <div class="row-header"><h2>${category}</h2></div>
        <div class="row-track">${list.map(cardHTML).join('')}</div>
      </div>
    `).join('');
  }

  if (albums.length) {
    html += `
      <div class="row">
        <div class="row-header"><h2>Álbuns de fotos</h2></div>
        <div class="albums-grid">${albums.map(albumCardHTML).join('')}</div>
      </div>
    `;
  }

  rowsEl.innerHTML = html;
}

(async () => {
  await requireSession();
  loadCatalog();
})();
