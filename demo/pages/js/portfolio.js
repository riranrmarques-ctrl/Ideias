function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

// ---------- Hero rotativo (mesmo comportamento da área privada) ----------
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
        <a class="btn btn-primary" id="heroCta" href="watch.html?id=${video.id}">▶ Assistir</a>
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
  document.getElementById('heroCta').href = `watch.html?id=${video.id}`;
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
function advanceHero() { loadHeroVideo((heroIndex + 1) % heroReels.length); }

function renderHero(reelVideos, fallback) {
  const section = document.getElementById('heroSection');
  if (!reelVideos.length) {
    if (!fallback) { section.innerHTML = ''; return; }
    section.innerHTML = `
      <section class="hero" style="background-image:url('${fallback.poster_url || fallback.cover_url || ''}'); background-size:cover; background-position:center;">
        <div class="hero-content">
          <div class="category">${fallback.category}</div>
          <h1>${fallback.title}</h1>
          <p>${fallback.description || ''}</p>
        </div>
      </section>
    `;
    return;
  }
  heroReels = reelVideos;
  section.innerHTML = heroMarkup(reelVideos[0]);
  document.getElementById('heroVideo').addEventListener('ended', advanceHero);
  loadHeroVideo(0);
}

// ---------- Cards ----------
function videoCardHTML(video) {
  return `
    <a class="card" href="watch.html?id=${video.id}">
      <div class="card-thumb" style="background-image:url('${video.poster_url || ''}')">
        ${video.max_quality ? `<span class="badge">${video.max_quality}</span>` : ''}
      </div>
      <div class="card-title">${video.title}</div>
      <div class="card-meta">${formatDuration(video.duration_seconds)}</div>
    </a>
  `;
}

function albumCardHTML(album) {
  return `
    <a class="card" href="album.html?id=${album.id}">
      <div class="card-thumb" style="background-image:url('${album.cover_url || ''}')">
        <span class="badge">📷 Álbum</span>
      </div>
      <div class="card-title">${album.title}</div>
    </a>
  `;
}

async function loadPortfolio() {
  const [videosRes, albumsRes, testimonialsRes] = await Promise.all([
    fetch('/api/videos/portfolio'),
    fetch('/api/albums/portfolio'),
    fetch('/api/testimonials/portfolio')
  ]);
  const videos = videosRes.ok ? await videosRes.json() : [];
  const albums = albumsRes.ok ? await albumsRes.json() : [];
  const testimonials = testimonialsRes.ok ? await testimonialsRes.json() : [];
  const rowsEl = document.getElementById('rows');

  const reels = videos.filter(v => v.orientation === 'vertical' && v.status === 'ready');
  const films = videos.filter(v => v.orientation !== 'vertical' && v.status === 'ready');

  renderHero(reels, films[0] || albums[0]);

  if (!films.length && !albums.length) {
    rowsEl.innerHTML = reels.length ? '' : `<div class="empty-state">
      <h2>Portfólio em construção</h2>
      <p>Assim que os primeiros filmes e álbuns forem publicados, eles aparecem aqui.</p>
    </div>`;
    return;
  }

  let html = '';

  if (films.length) {
    const byCategory = {};
    for (const v of films) { (byCategory[v.category] ||= []).push(v); }
    html += Object.entries(byCategory).map(([cat, list]) => `
      <div class="row">
        <div class="row-header"><h2>${cat}</h2></div>
        <div class="row-track">${list.map(videoCardHTML).join('')}</div>
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

  if (testimonials.length) {
    html += `
      <div class="row">
        <div class="row-header"><h2>O que os casais dizem</h2></div>
        <div class="row-track">
          ${testimonials.map(t => `
            <div class="card" style="width:280px;">
              <div class="card-thumb" style="background-image:url('${t.photo_url || ''}'); ${t.photo_url ? '' : 'background:var(--surface);'}"></div>
              <p style="font-size:13px; color:var(--ink-dim); margin-top:10px; line-height:1.5; font-style:italic;">"${t.quote}"</p>
              <div class="card-title" style="margin-top:6px;">— ${t.client_name}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  rowsEl.innerHTML = html;
}

(async () => {
  const user = await trySession();
  document.getElementById('loginLink').style.display = user ? 'none' : 'inline';
  document.getElementById('myAreaLink').style.display = user ? 'inline' : 'none';
  loadPortfolio();
})();
