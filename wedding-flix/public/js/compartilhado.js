let shareData = null;
let currentIndex = 0;
function el(id) { return document.getElementById(id); }

async function load() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');
  if (!token) { el('albumHeader').innerHTML = '<p style="padding:0 40px; color:var(--ink-dim);">Link inválido.</p>'; return; }

  const res = await fetch(`/api/albums/share/${token}`);
  if (!res.ok) {
    el('albumHeader').innerHTML = `<div style="text-align:center; padding:60px 20px;"><h1 style="font-size:22px;">Link inválido ou expirado</h1></div>`;
    return;
  }
  shareData = await res.json();
  shareData.__flat = [...shareData.sections.flatMap(s => s.photos), ...shareData.photos];

  el('albumHeader').innerHTML = `<h1>${shareData.title}</h1><p>${shareData.description || ''}</p>`;

  function grid(photos) {
    if (!photos.length) return '';
    return `<div class="photo-grid">${photos.map(p => {
      const i = shareData.__flat.findIndex(fp => fp.id === p.id);
      return `<div class="photo-thumb" style="background-image:url('${p.thumb_url}')" onclick="openLightbox(${i})">
        ${shareData.allowDownload ? `<a class="photo-download-btn" href="${p.url}" download onclick="event.stopPropagation()" title="Baixar">⬇</a>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  let html = '';
  for (const s of shareData.sections) {
    if (!s.photos.length) continue;
    html += `<div class="section-block">
      <div class="section-banner" style="background-image:url('${s.cover_url || ''}')">
        <div class="section-banner-text"><h2>${s.title}</h2>${s.description ? `<p>${s.description}</p>` : ''}</div>
      </div>${grid(s.photos)}</div>`;
  }
  if (shareData.photos.length) html += grid(shareData.photos);

  document.getElementById('photoGrid').outerHTML = `<main id="photoGrid">${html || '<div class="empty-state"><h2>Nenhuma foto aqui ainda</h2></div>'}</main>`;
}

function openLightbox(i) {
  currentIndex = i;
  el('lightboxImg').src = shareData.__flat[i].url;
  el('lightbox').classList.add('open');
}
window.openLightbox = openLightbox;
el('lightboxClose').addEventListener('click', () => el('lightbox').classList.remove('open'));
el('lightboxPrev').addEventListener('click', () => { currentIndex = (currentIndex - 1 + shareData.__flat.length) % shareData.__flat.length; el('lightboxImg').src = shareData.__flat[currentIndex].url; });
el('lightboxNext').addEventListener('click', () => { currentIndex = (currentIndex + 1) % shareData.__flat.length; el('lightboxImg').src = shareData.__flat[currentIndex].url; });

load();
