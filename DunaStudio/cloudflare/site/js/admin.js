let selectedVideoFile = null;
let selectedPosterFile = null;
let pollTimer = null;
let clients = [];
let activeAlbumIdForUpload = null;

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function ownerOptionsHTML() {
  return `<option value="">Público — aparece no portfólio pra qualquer visitante</option>` +
    clients.map(c => `<option value="${c.id}">${c.email}</option>`).join('');
}

async function loadClientsForDropdowns() {
  const res = await fetch('api/auth/users');
  if (!res.ok) return;
  const users = await res.json();
  clients = users.filter(u => !u.is_admin);
  document.getElementById('videoOwner').innerHTML = ownerOptionsHTML();
  document.getElementById('albumOwner').innerHTML = ownerOptionsHTML();
  const contractOwnerSelect = document.getElementById('contractOwner');
  if (contractOwnerSelect) {
    contractOwnerSelect.innerHTML = `<option value="">Selecione um cliente</option>` +
      clients.map(c => `<option value="${c.id}">${c.email}</option>`).join('');
  }
}

function ownerLabel(ownerId) {
  if (!ownerId) return '🌐 Público';
  const c = clients.find(x => x.id === ownerId);
  return c ? `🔒 ${c.email}` : '🔒 Privado';
}

// ---------- Upload de vídeo ----------
function setupDropZone(dropEl, inputEl, onFile) {
  dropEl.addEventListener('click', () => inputEl.click());
  inputEl.addEventListener('change', () => { if (inputEl.files[0]) onFile(inputEl.files[0]); });
  ['dragover', 'dragenter'].forEach(evt =>
    dropEl.addEventListener(evt, (e) => { e.preventDefault(); dropEl.classList.add('has-file'); })
  );
  dropEl.addEventListener('dragleave', () => { if (!dropEl.dataset.filled) dropEl.classList.remove('has-file'); });
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

setupDropZone(document.getElementById('videoDrop'), document.getElementById('videoInput'), (file) => {
  selectedVideoFile = file;
  const elx = document.getElementById('videoDrop');
  elx.textContent = `🎬 ${file.name} (${(file.size / (1024 ** 3)).toFixed(2)} GB)`;
  elx.classList.add('has-file'); elx.dataset.filled = '1';
});
setupDropZone(document.getElementById('posterDrop'), document.getElementById('posterInput'), (file) => {
  selectedPosterFile = file;
  const elx = document.getElementById('posterDrop');
  elx.textContent = `🖼️ ${file.name}`;
  elx.classList.add('has-file'); elx.dataset.filled = '1';
});

// ---------- Envio do filme: direto para o R2, em partes de 50 MB ----------
const PART_SIZE = window.STUDIO_PART_SIZE || 50 * 1024 * 1024;

async function apiJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

// Lê duração e tamanho do filme no próprio navegador (sem enviar nada)
function readVideoInfo(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const url = URL.createObjectURL(file);
    const done = (info) => { resolve({ ...info, video, url }); };
    const timer = setTimeout(() => done({ duration: 0, width: 0, height: 0 }), 15000);
    video.onloadedmetadata = () => { clearTimeout(timer); done({ duration: video.duration || 0, width: video.videoWidth, height: video.videoHeight }); };
    video.onerror = () => { clearTimeout(timer); done({ duration: 0, width: 0, height: 0 }); };
    video.src = url;
  });
}

// Tira um quadro do filme para usar como capa quando nenhuma imagem é enviada
function grabFrame(info) {
  return new Promise((resolve) => {
    const { video } = info;
    if (!info.width) return resolve(null);
    const timer = setTimeout(() => resolve(null), 10000);
    video.onseeked = () => {
      clearTimeout(timer);
      const scale = Math.min(1, 1600 / Math.max(info.width, info.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(info.width * scale);
      canvas.height = Math.round(info.height * scale);
      try {
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
      } catch { resolve(null); }
    };
    video.currentTime = Math.min(30, (info.duration || 10) * 0.2);
  });
}

function formatBytes(bytes) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

let uploadInProgress = false;
window.addEventListener('beforeunload', (e) => {
  if (uploadInProgress) { e.preventDefault(); e.returnValue = ''; }
});

document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedVideoFile) { showToast('Selecione o arquivo do filme'); return; }
  const file = selectedVideoFile;
  const submitBtn = document.getElementById('submitBtn');
  const progress = document.getElementById('uploadProgress');
  const setProgress = (msg) => { progress.style.display = 'block'; progress.textContent = msg; };
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enviando...';
  uploadInProgress = true;

  let videoId = null, uploadId = null;
  try {
    setProgress('Lendo o filme...');
    const info = await readVideoInfo(file);

    const created = await apiJson('api/videos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: document.getElementById('title').value,
        category: document.getElementById('category').value,
        description: document.getElementById('description').value,
        ownerUserId: document.getElementById('videoOwner').value,
        filename: file.name
      })
    });
    videoId = created.id;
    loadVideos();

    const poster = selectedPosterFile || await grabFrame(info);
    URL.revokeObjectURL(info.url);
    if (poster) {
      setProgress('Enviando a capa...');
      await apiJson(`api/videos/${videoId}/poster`, { method: 'PUT', headers: { 'Content-Type': poster.type || 'image/jpeg' }, body: poster });
    }

    ({ uploadId } = await apiJson(`api/videos/${videoId}/upload/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: file.type || 'video/mp4' })
    }));

    const totalParts = Math.ceil(file.size / PART_SIZE);
    const parts = [];
    const started = Date.now();
    for (let i = 0; i < totalParts; i++) {
      const chunk = file.slice(i * PART_SIZE, Math.min(file.size, (i + 1) * PART_SIZE));
      let attempt = 0;
      while (true) {
        try {
          const part = await apiJson(`api/videos/${videoId}/upload/part?uploadId=${encodeURIComponent(uploadId)}&part=${i + 1}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk
          });
          parts.push({ partNumber: part.partNumber, etag: part.etag });
          break;
        } catch (err) {
          if (++attempt >= 3) throw err;
          setProgress(`Falha na parte ${i + 1}. Tentando de novo...`);
          await new Promise(r => setTimeout(r, 2000 * attempt));
        }
      }
      const sent = Math.min(file.size, (i + 1) * PART_SIZE);
      const secs = (Date.now() - started) / 1000;
      const rate = sent / Math.max(secs, 1);
      const left = Math.round((file.size - sent) / Math.max(rate, 1) / 60);
      setProgress(`Enviando ${Math.round(sent / file.size * 100)}% · ${formatBytes(sent)} de ${formatBytes(file.size)}${left > 0 ? ` · cerca de ${left} min restantes` : ''}. Mantenha esta página aberta.`);
    }

    await apiJson(`api/videos/${videoId}/upload/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, parts, duration: info.duration, width: info.width, height: info.height })
    });

    setProgress('Filme publicado.');
    showToast('Filme enviado e publicado!');
    document.getElementById('uploadForm').reset();
    selectedVideoFile = null; selectedPosterFile = null;
    ['videoDrop', 'posterDrop'].forEach(id => {
      const elx = document.getElementById(id);
      elx.classList.remove('has-file'); delete elx.dataset.filled;
    });
    document.getElementById('videoDrop').textContent = 'Arraste o vídeo aqui ou clique para escolher';
    document.getElementById('posterDrop').textContent = 'Arraste a capa aqui ou clique para escolher';
  } catch (err) {
    setProgress(`O envio parou: ${err.message}`);
    showToast(err.message);
    if (videoId) {
      await fetch(`api/videos/${videoId}/upload/abort`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId })
      }).catch(() => {});
    }
  } finally {
    uploadInProgress = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Enviar filme';
    loadVideos();
  }
});

function statusPill(status) {
  if (status === 'ready') return `<span class="status-pill ready">pronto</span>`;
  if (status === 'error') return `<span class="status-pill error">envio interrompido</span>`;
  if (status === 'uploading') return `<span class="status-pill processing">enviando</span>`;
  return `<span class="status-pill processing">${status}</span>`;
}

async function loadVideos() {
  const res = await fetch('api/videos');
  const videos = await res.json();
  const tbody = document.querySelector('#videosTable tbody');
  tbody.innerHTML = videos.map(v => `
    <tr>
      <td>${v.title}</td>
      <td>${v.category}</td>
      <td>${v.orientation === 'vertical' ? '📱 Capa' : '🎬 Filme'}</td>
      <td>${ownerLabel(v.owner_user_id)}</td>
      <td>${statusPill(v.status)}</td>
      <td>${v.max_quality || '—'}</td>
      <td><button class="icon-btn" onclick="deleteVideo(${v.id}, '${v.title.replace(/'/g, "\\'")}')">Excluir</button></td>
    </tr>
  `).join('') || `<tr><td colspan="7" style="color:var(--ink-dim);">Nenhum vídeo cadastrado ainda.</td></tr>`;

  const stillProcessing = !uploadInProgress && videos.some(v => v.status === 'uploading');
  if (stillProcessing && !pollTimer) pollTimer = setInterval(loadVideos, 4000);
  else if (!stillProcessing && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

window.deleteVideo = async (id, title) => {
  if (!confirm(`Excluir "${title}"? Isso apaga o filme do R2 também.`)) return;
  await fetch(`api/videos/${id}`, { method: 'DELETE' });
  showToast('Excluído');
  loadVideos();
};

// ---------- Álbuns ----------
document.getElementById('albumForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: document.getElementById('albumTitle').value,
    category: document.getElementById('albumCategory').value,
    description: document.getElementById('albumDescription').value,
    ownerUserId: document.getElementById('albumOwner').value
  };
  const res = await fetch('api/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Erro ao criar álbum'); return; }
  showToast('Álbum criado! Agora adicione as fotos na lista abaixo.');
  document.getElementById('albumForm').reset();
  loadAlbums();
  openPhotoUpload(data.id, payload.title);
});

async function loadAlbums() {
  const res = await fetch('api/albums');
  const albums = await res.json();
  const tbody = document.querySelector('#albumsTable tbody');
  tbody.innerHTML = albums.map(a => `
    <tr>
      <td>${a.title}</td>
      <td>${a.category}</td>
      <td>${ownerLabel(a.owner_user_id)}</td>
      <td id="photoCount-${a.id}">…</td>
      <td>
        <button class="icon-btn" style="color:var(--gold);" onclick="openPhotoUpload(${a.id}, '${a.title.replace(/'/g, "\\'")}')">+ fotos</button>
        <a class="icon-btn" style="color:var(--gold); text-decoration:none;" href="album.html?id=${a.id}" target="_blank">ver</a>
        <button class="icon-btn" onclick="deleteAlbum(${a.id}, '${a.title.replace(/'/g, "\\'")}')">excluir</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="5" style="color:var(--ink-dim);">Nenhum álbum cadastrado ainda.</td></tr>`;

  for (const a of albums) {
    fetch(`api/albums/${a.id}`).then(r => r.json()).then(full => {
      const cell = document.getElementById(`photoCount-${a.id}`);
      if (cell) cell.textContent = full.allPhotosCount ?? 0;
    });
  }
}

window.openPhotoUpload = async (albumId, title) => {
  activeAlbumIdForUpload = albumId;
  document.getElementById('photoUploadArea').style.display = 'block';
  document.getElementById('photoUploadAlbumTitle').textContent = title;
  await loadSectionsForAlbum(albumId);
  document.getElementById('photoUploadArea').scrollIntoView({ behavior: 'smooth', block: 'center' });
};

async function loadSectionsForAlbum(albumId) {
  const res = await fetch(`api/albums/${albumId}`);
  const album = await res.json();
  const select = document.getElementById('sectionSelect');
  select.innerHTML = `<option value="">Sem seção (fotos gerais)</option>` +
    (album.sections || []).map(s => `<option value="${s.id}">${s.title} (${s.photos.length} fotos)</option>`).join('');
}

document.getElementById('createSectionBtn').addEventListener('click', async () => {
  const title = document.getElementById('newSectionTitle').value.trim();
  if (!title || !activeAlbumIdForUpload) { showToast('Digite o nome da seção'); return; }
  const res = await fetch(`api/albums/${activeAlbumIdForUpload}/sections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Erro ao criar seção'); return; }
  document.getElementById('newSectionTitle').value = '';
  await loadSectionsForAlbum(activeAlbumIdForUpload);
  document.getElementById('sectionSelect').value = data.id;
  showToast(`Seção "${title}" criada — agora escolha as fotos e envie.`);
});

document.getElementById('cancelPhotoUpload').addEventListener('click', () => {
  activeAlbumIdForUpload = null;
  document.getElementById('photoUploadArea').style.display = 'none';
  document.getElementById('photoFilesInput').value = '';
});

document.getElementById('uploadPhotosBtn').addEventListener('click', async () => {
  const files = document.getElementById('photoFilesInput').files;
  if (!files.length || !activeAlbumIdForUpload) { showToast('Escolha ao menos uma foto'); return; }
  const albumId = activeAlbumIdForUpload;
  const sectionId = document.getElementById('sectionSelect').value;
  const btn = document.getElementById('uploadPhotosBtn');
  btn.disabled = true;
  uploadInProgress = true;
  try {
    const result = await window.studioUploadPhotos(`api/albums/${albumId}/files`, files, sectionId ? { section: sectionId } : {},
      (done, total, failed) => { btn.textContent = `Enviando ${done} de ${total}${failed ? ` (${failed} com erro)` : ''}...`; });
    showToast(result.failed ? `${result.done - result.failed} foto(s) enviadas, ${result.failed} com erro: ${result.errors[0]}` : `${result.done} foto(s) enviadas!`);
    document.getElementById('photoFilesInput').value = '';
    loadAlbums();
    loadSectionsForAlbum(albumId);
  } catch (err) {
    showToast(err.message);
  } finally {
    uploadInProgress = false;
    btn.disabled = false;
    btn.textContent = 'Enviar fotos';
  }
});

window.deleteAlbum = async (id, title) => {
  if (!confirm(`Excluir álbum "${title}"? Isso remove todas as fotos do R2 também.`)) return;
  await fetch(`api/albums/${id}`, { method: 'DELETE' });
  showToast('Álbum excluído');
  loadAlbums();
};

// ---------- Pacotes de serviço ----------
function parsePackageItems(text) {
  return text.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const [label, priceStr, flag] = line.split('|').map(s => s.trim());
    return {
      label,
      price: parseFloat((priceStr || '0').replace(',', '.')) || 0,
      defaultIncluded: (flag || '').toLowerCase().startsWith('inclus')
    };
  });
}

document.getElementById('createPackageBtn').addEventListener('click', async () => {
  const title = document.getElementById('packageTitle').value.trim();
  const description = document.getElementById('packageDescription').value.trim();
  const itemsText = document.getElementById('packageItems').value.trim();
  if (!title) { showToast('Digite o título do pacote'); return; }

  const items = itemsText ? parsePackageItems(itemsText) : [];
  const res = await fetch('api/packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, description, items })
  });
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Erro ao criar pacote'); return; }

  showToast('Pacote criado! Já aparece em /pacotes.html');
  document.getElementById('packageTitle').value = '';
  document.getElementById('packageDescription').value = '';
  document.getElementById('packageItems').value = '';
  loadPackages();
});

async function loadPackages() {
  const res = await fetch('api/packages');
  if (!res.ok) return;
  const packages = await res.json();
  const tbody = document.querySelector('#packagesTable tbody');
  tbody.innerHTML = packages.map(p => `
    <tr>
      <td>${p.title}</td>
      <td>R$ ${p.basePrice.toFixed(2)}</td>
      <td>${p.items.length}</td>
      <td><button class="icon-btn" onclick="deletePackage(${p.id}, '${p.title.replace(/'/g, "\\'")}')">excluir</button></td>
    </tr>
  `).join('') || `<tr><td colspan="4" style="color:var(--ink-dim);">Nenhum pacote cadastrado ainda.</td></tr>`;
}

window.deletePackage = async (id, title) => {
  if (!confirm(`Excluir pacote "${title}"?`)) return;
  await fetch(`api/packages/${id}`, { method: 'DELETE' });
  showToast('Pacote excluído');
  loadPackages();
};

async function loadOrders() {
  const res = await fetch('api/packages/orders/all');
  if (!res.ok) return;
  const orders = await res.json();
  const tbody = document.querySelector('#ordersTable tbody');
  const statusLabel = { approved: 'pago', pending: 'aguardando', rejected: 'recusado' };
  const statusClass = { approved: 'ready', pending: 'processing', rejected: 'error' };
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td>${o.package_title}</td>
      <td>${o.payer_name || '—'}<br><span style="color:var(--ink-dim); font-size:11px;">${o.payer_email || ''}</span></td>
      <td>R$ ${o.total.toFixed(2)}</td>
      <td><span class="status-pill ${statusClass[o.status] || ''}">${statusLabel[o.status] || o.status}</span></td>
      <td>${new Date(o.created_at).toLocaleDateString('pt-BR')}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" style="color:var(--ink-dim);">Nenhuma venda ainda.</td></tr>`;
}

// ---------- Produtos físicos ----------
document.getElementById('createProductBtn').addEventListener('click', async () => {
  const title = document.getElementById('productTitle').value.trim();
  const price = document.getElementById('productPrice').value;
  const description = document.getElementById('productDescription').value.trim();
  if (!title || !price) { showToast('Preencha nome e preço'); return; }
  const res = await fetch('api/products', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, price, description })
  });
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Erro ao criar produto'); return; }
  showToast('Produto adicionado à loja');
  document.getElementById('productTitle').value = '';
  document.getElementById('productPrice').value = '';
  document.getElementById('productDescription').value = '';
  loadProducts();
});

async function loadProducts() {
  const res = await fetch('api/products');
  if (!res.ok) return;
  const products = await res.json();
  document.querySelector('#productsTable tbody').innerHTML = products.map(p => `
    <tr>
      <td>${p.title}</td>
      <td>R$ ${p.price.toFixed(2)}</td>
      <td><button class="icon-btn" onclick="deleteProduct(${p.id}, '${p.title.replace(/'/g, "\\'")}')">excluir</button></td>
    </tr>
  `).join('') || `<tr><td colspan="3" style="color:var(--ink-dim);">Nenhum produto cadastrado ainda.</td></tr>`;
}

window.deleteProduct = async (id, title) => {
  if (!confirm(`Excluir "${title}" da loja?`)) return;
  await fetch(`api/products/${id}`, { method: 'DELETE' });
  loadProducts();
};

async function loadProductOrders() {
  const res = await fetch('api/products/orders/all');
  if (!res.ok) return;
  const orders = await res.json();
  const statusLabel = { approved: 'pago', pending: 'aguardando', rejected: 'recusado' };
  const statusClass = { approved: 'ready', pending: 'processing', rejected: 'error' };
  document.querySelector('#productOrdersTable tbody').innerHTML = orders.map(o => `
    <tr>
      <td>${o.product_title} (x${o.quantity})</td>
      <td>${o.payer_name || '—'}<br><span style="color:var(--ink-dim); font-size:11px;">${o.payer_email || ''}</span></td>
      <td>R$ ${o.total.toFixed(2)}</td>
      <td><span class="status-pill ${statusClass[o.status] || ''}">${statusLabel[o.status] || o.status}</span></td>
    </tr>
  `).join('') || `<tr><td colspan="4" style="color:var(--ink-dim);">Nenhum pedido ainda.</td></tr>`;
}

// ---------- Depoimentos ----------
async function loadTestimonials() {
  const res = await fetch('api/testimonials');
  if (!res.ok) return;
  const rows = await res.json();
  document.querySelector('#testimonialsTable tbody').innerHTML = rows.map(t => `
    <tr>
      <td>${t.client_name}<br><span style="color:var(--ink-dim); font-size:11px;">${t.owner_email}</span></td>
      <td style="max-width:260px;">${t.quote}</td>
      <td><span class="status-pill ${t.approved ? 'ready' : 'processing'}">${t.approved ? 'publicado' : 'pendente'}</span></td>
      <td>
        ${!t.approved ? `<button class="icon-btn" style="color:var(--gold);" onclick="approveTestimonial(${t.id})">aprovar</button>` : ''}
        <button class="icon-btn" onclick="deleteTestimonial(${t.id})">excluir</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="4" style="color:var(--ink-dim);">Nenhum depoimento recebido ainda.</td></tr>`;
}

window.approveTestimonial = async (id) => {
  await fetch(`api/testimonials/${id}/approve`, { method: 'PATCH' });
  showToast('Depoimento publicado no portfólio!');
  loadTestimonials();
};
window.deleteTestimonial = async (id) => {
  if (!confirm('Excluir este depoimento?')) return;
  await fetch(`api/testimonials/${id}`, { method: 'DELETE' });
  loadTestimonials();
};

// ---------- Contratos ----------
function parseEventsText(text) {
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const [titlePart, ...rest] = lines;
    const [title, date] = titlePart.split('|').map(s => s.trim());
    return { title, event_date: date || '', items: rest };
  });
}

document.getElementById('createContractBtn').addEventListener('click', async () => {
  const ownerUserId = document.getElementById('contractOwner').value;
  const title = document.getElementById('contractTitle').value.trim();
  const body = document.getElementById('contractBody').value.trim();
  const eventsText = document.getElementById('contractEvents').value.trim();

  if (!ownerUserId || !title) { showToast('Selecione o cliente e o título'); return; }

  const events = eventsText ? parseEventsText(eventsText) : [];
  const res = await fetch('api/contracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerUserId, title, body, events })
  });
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Erro ao criar contrato'); return; }

  showToast('Contrato criado! O cliente já pode assinar na área dele.');
  document.getElementById('contractTitle').value = '';
  document.getElementById('contractBody').value = '';
  document.getElementById('contractEvents').value = '';
  loadContracts();
});

async function loadContracts() {
  const res = await fetch('api/contracts');
  if (!res.ok) return;
  const contracts = await res.json();
  const tbody = document.querySelector('#contractsTable tbody');
  tbody.innerHTML = contracts.map(c => `
    <tr>
      <td>${c.title}</td>
      <td>${c.owner_email}</td>
      <td><span class="status-pill ${c.status === 'signed' ? 'ready' : 'processing'}">${c.status === 'signed' ? 'assinado' : 'pendente'}</span></td>
      <td>
        <a class="icon-btn" style="color:var(--gold); text-decoration:none;" href="contract.html?id=${c.id}" target="_blank">ver</a>
        <button class="icon-btn" onclick="deleteContract(${c.id}, '${c.title.replace(/'/g, "\\'")}')">excluir</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="4" style="color:var(--ink-dim);">Nenhum contrato cadastrado ainda.</td></tr>`;
}

window.deleteContract = async (id, title) => {
  if (!confirm(`Excluir contrato "${title}"?`)) return;
  await fetch(`api/contracts/${id}`, { method: 'DELETE' });
  showToast('Contrato excluído');
  loadContracts();
};

// ---------- Contas de clientes ----------
document.getElementById('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('userEmail').value;
  const password = document.getElementById('userPassword').value;
  try {
    const res = await fetch('api/auth/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(data.existed ? 'Esse e-mail já tinha conta: o acesso ao Studio foi liberado com a senha atual dele.' : 'Cliente criado! Envie o e-mail e a senha pra ele.');
    document.getElementById('userForm').reset();
    loadUsers();
    loadClientsForDropdowns();
  } catch (err) {
    showToast(err.message);
  }
});

async function loadUsers() {
  const res = await fetch('api/auth/users');
  const users = await res.json();
  const tbody = document.querySelector('#usersTable tbody');
  const list = users.filter(u => !u.is_admin);
  tbody.innerHTML = list.map(u => `
    <tr>
      <td>${u.email}</td>
      <td>${new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
      <td><button class="icon-btn" onclick="deleteUser('${u.id}', '${u.email}')">Remover acesso</button></td>
    </tr>
  `).join('') || `<tr><td colspan="3" style="color:var(--ink-dim);">Nenhum cliente cadastrado ainda.</td></tr>`;
}

window.deleteUser = async (id, email) => {
  if (!confirm(`Remover o acesso de ${email} ao Studio?`)) return;
  await fetch(`api/auth/users/${id}`, { method: 'DELETE' });
  loadUsers();
  loadClientsForDropdowns();
};

(async () => {
  const user = await requireSession();
  if (!user.isAdmin) { window.location.href = 'index.html'; return; }
  await loadClientsForDropdowns();
  loadVideos();
  loadAlbums();
  loadPackages();
  loadOrders();
  loadProducts();
  loadProductOrders();
  loadTestimonials();
  loadContracts();
  loadUsers();
})();
