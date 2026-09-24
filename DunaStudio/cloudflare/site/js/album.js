let albumData = null;
let currentPhotoIndex = 0;
let canDownload = false;

function el(id) { return document.getElementById(id); }

async function loadAlbum() {
  const params = new URLSearchParams(window.location.search);
  const albumId = params.get('id');
  if (!albumId) { window.location.href = './'; return; }

  const user = await trySession();
  el('backLink').href = user ? 'index.html' : './';

  const res = await fetch(`api/albums/${albumId}`);
  if (res.status === 403) {
    document.querySelector('main').innerHTML = '';
    el('albumHeader').innerHTML = `
      <div style="text-align:center; padding:60px 20px;">
        <h1 style="font-size:22px;">Este álbum é privado</h1>
        <p style="color:var(--ink-dim); margin:10px 0 20px;">Faça login com a conta do cliente pra ver as fotos.</p>
        <a class="btn btn-primary" href="login.html">Entrar</a>
      </div>`;
    return;
  }
  if (!res.ok) { window.location.href = './'; return; }
  albumData = await res.json();

  const canInteract = !!user; // download/comentário exigem login; o backend valida propriedade de fato
  canDownload = canInteract;

  el('albumHeader').innerHTML = `
    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px;">
      <div>
        <h1>${albumData.title}</h1>
        <p>${albumData.description || ''}</p>
      </div>
      <div style="display:flex; gap:8px; flex-shrink:0;">
        ${canInteract ? `<button class="photo-download-btn" style="position:static; width:auto; min-width:38px; height:38px; font-size:16px; padding:0 10px;" id="zipBtn" title="Baixar álbum inteiro (.zip)">⬇</button>` : ''}
        ${canInteract ? `<button class="photo-download-btn" style="position:static; width:38px; height:38px; font-size:15px;" id="manageToggleBtn" title="Compartilhar e convidados">⚙</button>` : ''}
      </div>
    </div>
  `;

  if (canInteract) setupManagePanel();
  const zipBtn = document.getElementById('zipBtn');
  if (zipBtn) zipBtn.addEventListener('click', () => downloadAlbumZip(zipBtn));

  function photoGridHTML(photos) {
    if (!photos.length) return '';
    return `<div class="photo-grid">${photos.map(p => {
      const globalIndex = albumData.__flatPhotos.findIndex(fp => fp.id === p.id);
      return `
        <div class="photo-thumb" style="background-image:url('${p.thumb_url}')" onclick="openLightbox(${globalIndex})">
          ${canInteract ? `<a class="photo-download-btn" href="${p.download_url}" onclick="event.stopPropagation()" title="Baixar esta foto">⬇</a>` : ''}
        </div>`;
    }).join('')}</div>`;
  }

  // Lista "achatada" de todas as fotos (seções + gerais), na ordem em que aparecem na página — usada pra navegação da ampliação
  albumData.__flatPhotos = [
    ...albumData.sections.flatMap(s => s.photos),
    ...albumData.photos
  ];

  let bodyHTML = '';
  for (const section of albumData.sections) {
    if (!section.photos.length) continue;
    bodyHTML += `
      <div class="section-block">
        <div class="section-banner" style="background-image:url('${section.cover_url || ''}'); position:relative;">
          ${canInteract ? `<button class="section-share-btn" onclick="shareSection(${section.id})" title="Compartilhar esta seção">🔗</button>` : ''}
          <div class="section-banner-text">
            <h2>${section.title}</h2>
            ${section.description ? `<p>${section.description}</p>` : ''}
          </div>
        </div>
        ${photoGridHTML(section.photos)}
      </div>
    `;
  }
  if (albumData.photos.length) {
    bodyHTML += albumData.sections.length
      ? `<div class="section-block"><div class="section-heading-simple"><h2>Fotos gerais</h2></div>${photoGridHTML(albumData.photos)}</div>`
      : photoGridHTML(albumData.photos);
  }

  document.getElementById('photoGrid').outerHTML = `<main id="photoGrid">${bodyHTML || '<div class="empty-state"><h2>Nenhuma foto neste álbum ainda</h2></div>'}</main>`;

  if (canInteract) {
    el('albumComments').style.display = 'block';
    loadComments();
  }
}

// Monta o .zip do álbum no próprio navegador, sem compressão (fotos já são comprimidas)
async function downloadAlbumZip(btn) {
  const photos = albumData.__flatPhotos;
  if (!photos.length) return;
  if (!window.JSZip) { alert('Não foi possível preparar o download. Recarregue a página.'); return; }
  const totalBytes = photos.reduce((sum, p) => sum + (p.size_bytes || 0), 0);
  if (totalBytes > 1.8 * 1024 ** 3) {
    alert('Este álbum é grande demais para baixar de uma vez só pelo navegador. Baixe as fotos pelas setas ⬇ de cada uma ou peça o link completo à Duna.');
    return;
  }
  btn.disabled = true;
  const zip = new JSZip();
  const used = new Set();
  let done = 0, next = 0;
  async function worker() {
    while (next < photos.length) {
      const index = next++;
      const photo = photos[index];
      const res = await fetch(photo.url);
      if (!res.ok) throw new Error('Falha ao baixar uma das fotos. Recarregue a página e tente de novo.');
      let name = photo.original_name || `foto-${index + 1}.jpg`;
      if (used.has(name)) name = `${index + 1}-${name}`;
      used.add(name);
      zip.file(name, await res.blob(), { binary: true });
      btn.textContent = `${++done}/${photos.length}`;
    }
  }
  try {
    await Promise.all([worker(), worker(), worker(), worker()]);
    btn.textContent = 'zip…';
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${albumData.title.replace(/[^\w\-]+/g, '_')}.zip`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 60000);
  } catch (err) {
    alert(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '⬇';
  }
}

function setupManagePanel() {
  const btn = document.getElementById('manageToggleBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const panel = el('managePanel');
    if (panel.style.display === 'none') {
      panel.innerHTML = `
        <h3>Compartilhar álbum inteiro</h3>
        <div class="manage-row">
          <label><input type="checkbox" id="albumAllowDownload"> Permitir que quem receber o link também baixe as fotos</label>
        </div>
        <div class="manage-row">
          <button class="btn btn-ghost" id="genAlbumLinkBtn">Gerar / atualizar link</button>
          <div class="manage-link-box" id="albumLinkBox" style="display:none; flex:1;"></div>
        </div>
        <h3 style="margin-top:18px;">Convidados podem enviar fotos</h3>
        <div class="manage-row">
          <label><input type="checkbox" id="guestUploadToggle"> Ativar upload dos convidados (link pra festa)</label>
        </div>
        <div class="manage-link-box" id="guestLinkBox" style="display:none;"></div>
      `;
      document.getElementById('genAlbumLinkBtn').addEventListener('click', async () => {
        const allow = document.getElementById('albumAllowDownload').checked;
        const res = await fetch(`api/albums/${albumData.id}/share`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowDownload: allow })
        });
        const data = await res.json();
        if (res.ok) {
          const url = `${window.location.href.replace(/[^/]*$/, "")}compartilhado.html?t=${data.token}`;
          const box = document.getElementById('albumLinkBox');
          box.style.display = 'block';
          box.innerHTML = `${url} <button class="icon-btn" style="color:var(--gold);" onclick="navigator.clipboard.writeText('${url}'); this.textContent='copiado!'">copiar</button>`;
        }
      });
      document.getElementById('guestUploadToggle').addEventListener('change', async (e) => {
        const res = await fetch(`api/albums/${albumData.id}/guest-upload/toggle`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: e.target.checked })
        });
        const data = await res.json();
        const box = document.getElementById('guestLinkBox');
        if (data.token) {
          const url = `${window.location.href.replace(/[^/]*$/, "")}convidados.html?t=${data.token}`;
          box.style.display = 'block';
          box.innerHTML = `${url} <button class="icon-btn" style="color:var(--gold);" onclick="navigator.clipboard.writeText('${url}'); this.textContent='copiado!'">copiar</button>`;
        } else {
          box.style.display = 'none';
        }
      });
      panel.style.display = 'block';
    } else {
      panel.style.display = 'none';
    }
  });
}

window.shareSection = async (sectionId) => {
  const allow = confirm('Permitir que quem receber o link também baixe as fotos desta seção?\n\nOK = sim, permitir download\nCancelar = só visualização');
  const res = await fetch(`api/albums/${albumData.id}/sections/${sectionId}/share`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowDownload: allow })
  });
  const data = await res.json();
  if (res.ok) {
    const url = `${window.location.href.replace(/[^/]*$/, "")}compartilhado.html?t=${data.token}`;
    navigator.clipboard.writeText(url).catch(() => {});
    alert(`Link copiado!\n\n${url}`);
  }
};

// ---------- Pedido de produto físico ----------
async function openOrderPanel(photo) {
  const res = await fetch('api/products');
  const products = res.ok ? await res.json() : [];
  const panel = el('orderPanel');

  if (!products.length) {
    panel.innerHTML = `<div class="order-panel-inner"><p>Nenhum produto disponível no momento.</p><button class="btn btn-ghost" onclick="document.getElementById('orderPanel').style.display='none'">Fechar</button></div>`;
    panel.style.display = 'flex';
    return;
  }

  panel.innerHTML = `
    <div class="order-panel-inner">
      <h3>Pedir produto físico</h3>
      ${products.map(p => `
        <div class="product-option">
          <span>${p.title}</span>
          <span class="price">R$ ${p.price.toFixed(2)}</span>
        </div>
      `).join('')}
      <div class="field" style="margin-top:14px;"><label>Produto</label>
        <select id="orderProduct">${products.map(p => `<option value="${p.id}" data-price="${p.price}">${p.title} — R$ ${p.price.toFixed(2)}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Quantidade</label><input type="number" id="orderQty" value="1" min="1"></div>
      <div class="field"><label>Seu nome</label><input type="text" id="orderName"></div>
      <div class="field"><label>Seu e-mail</label><input type="email" id="orderEmail" required></div>
      <button class="btn btn-primary" style="width:100%; justify-content:center;" id="confirmOrderBtn">Ir para o pagamento →</button>
      <button class="btn btn-ghost" style="width:100%; justify-content:center; margin-top:8px;" onclick="document.getElementById('orderPanel').style.display='none'">Cancelar</button>
    </div>
  `;
  panel.style.display = 'flex';

  document.getElementById('confirmOrderBtn').addEventListener('click', async () => {
    const productId = document.getElementById('orderProduct').value;
    const quantity = document.getElementById('orderQty').value;
    const payerName = document.getElementById('orderName').value.trim();
    const payerEmail = document.getElementById('orderEmail').value.trim();
    if (!payerEmail) { alert('Digite seu e-mail.'); return; }

    const btn = document.getElementById('confirmOrderBtn');
    btn.disabled = true; btn.textContent = 'Redirecionando...';
    try {
      const res = await fetch(`api/products/${productId}/order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoId: photo.id, albumId: albumData.id, quantity, payerName, payerEmail })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar pedido');
      window.location.href = data.checkoutUrl;
    } catch (err) {
      alert(err.message);
      btn.disabled = false; btn.textContent = 'Ir para o pagamento →';
    }
  });
}

function openLightbox(index) {
  currentPhotoIndex = index;
  renderLightbox();
  el('lightbox').classList.add('open');
}

function renderLightbox() {
  const photo = albumData.__flatPhotos[currentPhotoIndex];
  el('lightboxImg').src = photo.url;
  el('lightboxDownload').style.display = canDownload ? 'inline-flex' : 'none';
  el('lightboxDownload').onclick = () => {
    window.location.href = photo.download_url;
  };
  el('lightboxOrder').onclick = () => openOrderPanel(photo);
}

el('lightboxClose').addEventListener('click', () => el('lightbox').classList.remove('open'));
el('lightboxPrev').addEventListener('click', () => {
  currentPhotoIndex = (currentPhotoIndex - 1 + albumData.__flatPhotos.length) % albumData.__flatPhotos.length;
  renderLightbox();
});
el('lightboxNext').addEventListener('click', () => {
  currentPhotoIndex = (currentPhotoIndex + 1) % albumData.__flatPhotos.length;
  renderLightbox();
});
el('lightbox').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox') el('lightbox').classList.remove('open');
});
document.addEventListener('keydown', (e) => {
  if (!el('lightbox').classList.contains('open')) return;
  if (e.key === 'Escape') el('lightbox').classList.remove('open');
  if (e.key === 'ArrowLeft') el('lightboxPrev').click();
  if (e.key === 'ArrowRight') el('lightboxNext').click();
});

async function loadComments() {
  const res = await fetch(`api/albums/${albumData.id}/comments`);
  if (!res.ok) { el('albumComments').style.display = 'none'; return; }
  const comments = await res.json();
  el('commentsList').innerHTML = comments.length
    ? comments.map(c => `
        <div class="comment-item">
          <div>${c.body}</div>
          <div class="meta">${c.author} · ${new Date(c.created_at).toLocaleString('pt-BR')}</div>
        </div>
      `).join('')
    : `<p style="color:var(--ink-dim); font-size:14px;">Nenhum comentário ainda.</p>`;
}

el('commentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = el('commentInput').value.trim();
  if (!body) return;
  const res = await fetch(`api/albums/${albumData.id}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body })
  });
  if (res.ok) {
    el('commentInput').value = '';
    loadComments();
  } else {
    const data = await res.json();
    alert(data.error || 'Erro ao comentar');
  }
});

window.openLightbox = openLightbox;
loadAlbum();
