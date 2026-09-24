(async () => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('t');
  const content = document.getElementById('content');
  if (!token) { content.innerHTML = '<p style="text-align:center;">Link inválido.</p>'; return; }

  const res = await fetch(`api/albums/guest-upload/${token}`);
  if (!res.ok) { content.innerHTML = '<p style="text-align:center;">Este link de envio não está mais ativo.</p>'; return; }
  const album = await res.json();

  content.innerHTML = `
    <h2 style="font-size:18px; text-align:center; margin-bottom:6px;">${album.title}</h2>
    <p style="text-align:center; color:var(--ink-dim); font-size:13px; margin-bottom:20px;">Compartilhe suas fotos e vídeos do casamento com os noivos!</p>
    <div class="field"><label>Seu nome</label><input type="text" id="uploaderName" placeholder="Como quer aparecer"></div>
    <div class="file-field" id="dropZone">Toque aqui pra escolher suas fotos</div>
    <input type="file" id="fileInput" accept="image/*" multiple style="display:none;">
    <button class="btn btn-primary" id="sendBtn" style="width:100%; justify-content:center; margin-top:14px;">Enviar fotos</button>
    <p id="status" style="text-align:center; font-size:13px; color:var(--gold); margin-top:12px;"></p>
  `;

  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  let selectedFiles = [];

  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    selectedFiles = Array.from(fileInput.files);
    dropZone.textContent = `${selectedFiles.length} foto(s) selecionada(s)`;
    dropZone.classList.add('has-file');
  });

  document.getElementById('sendBtn').addEventListener('click', async () => {
    if (!selectedFiles.length) { alert('Escolha ao menos uma foto.'); return; }
    const name = document.getElementById('uploaderName').value.trim() || 'Convidado';
    const btn = document.getElementById('sendBtn');
    const status = document.getElementById('status');
    btn.disabled = true;
    const result = await window.studioUploadPhotos(`api/albums/guest-upload/${encodeURIComponent(token)}/files`, selectedFiles, { uploader: name },
      (done, total) => { btn.textContent = `Enviando ${done} de ${total}...`; });
    const sent = result.done - result.failed;
    if (sent > 0) {
      status.textContent = result.failed
        ? `Obrigado! ${sent} foto(s) chegaram ao álbum. ${result.failed} não foram enviadas: ${result.errors[0]}`
        : `Obrigado! Suas ${sent} foto(s) já estão no álbum dos noivos. 🎉`;
      btn.textContent = 'Enviado!';
    } else {
      alert(result.errors[0] || 'Não foi possível enviar as fotos');
      btn.disabled = false;
      btn.textContent = 'Enviar fotos';
    }
  });
})();
