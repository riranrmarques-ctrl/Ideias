(async () => {
  const user = await trySession();
  document.querySelector('.back').href = user ? '/index.html' : '/';

  const params = new URLSearchParams(window.location.search);
  const videoId = params.get('id');
  if (!videoId) { window.location.href = '/'; return; }

  const res = await fetch(`/api/videos/${videoId}`);
  if (res.status === 403) {
    document.querySelector('.watch-wrap').innerHTML = `
      <div class="watch-info" style="padding-top:80px; max-width:480px; margin:0 auto; text-align:center;">
        <h2>Este vídeo é privado</h2>
        <p style="margin-bottom:20px;">Faça login com a conta do cliente pra assistir.</p>
        <a class="btn btn-primary" href="/login.html">Entrar</a>
      </div>`;
    return;
  }
  if (!res.ok) { window.location.href = '/'; return; }
  const video = await res.json();

  document.getElementById('videoTitleTop').textContent = video.title;
  document.getElementById('videoTitle').textContent = video.title;
  document.getElementById('videoDescription').textContent = video.description || '';

  if (video.max_quality) {
    const tag = document.getElementById('qualityTag');
    tag.textContent = `Qualidade máxima: ${video.max_quality}`;
    tag.style.display = 'inline-block';
  }

  if (video.orientation === 'vertical') {
    document.querySelector('.watch-wrap').classList.add('is-vertical');
  }

  const videoEl = document.getElementById('player');
  const progressKey = 'wf_progress_' + video.id;

  if (video.status !== 'ready') {
    document.querySelector('.watch-info').insertAdjacentHTML('beforeend',
      `<p style="color:var(--gold); margin-top:12px;">Este vídeo ainda está sendo processado. Volte em alguns minutos.</p>`);
    return;
  }

  function restoreProgress() {
    try {
      const raw = localStorage.getItem(progressKey);
      if (!raw) return;
      const { time } = JSON.parse(raw);
      if (time && time > 5) videoEl.currentTime = time;
    } catch {}
  }

  function saveProgress() {
    if (!videoEl.duration) return;
    const pct = Math.round((videoEl.currentTime / videoEl.duration) * 100);
    localStorage.setItem(progressKey, JSON.stringify({ time: videoEl.currentTime, pct }));
  }

  videoEl.addEventListener('timeupdate', () => {
    // salva a cada ~5s de reprodução, não a cada frame
    if (Math.floor(videoEl.currentTime) % 5 === 0) saveProgress();
  });
  videoEl.addEventListener('pause', saveProgress);
  window.addEventListener('beforeunload', saveProgress);

  if (Hls.isSupported()) {
    const hls = new Hls({ startLevel: -1, capLevelToPlayerSize: true });
    hls.loadSource(video.hls_url);
    hls.attachMedia(videoEl);
    hls.on(Hls.Events.MANIFEST_PARSED, () => restoreProgress());
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari/iOS tocam HLS nativamente
    videoEl.src = video.hls_url;
    videoEl.addEventListener('loadedmetadata', restoreProgress, { once: true });
  } else {
    document.querySelector('.watch-info').insertAdjacentHTML('beforeend',
      `<p style="color:var(--danger); margin-top:12px;">Seu navegador não suporta reprodução HLS.</p>`);
  }
})();
