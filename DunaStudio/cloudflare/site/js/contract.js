let currentContract = null;
let signaturePad = null;
let isDrawing = false;
let hasSignature = false;

function el(id) { return document.getElementById(id); }

async function loadContract() {
  const user = await requireSession();
  const params = new URLSearchParams(window.location.search);
  const idParam = params.get('id');

  let contract;
  if (idParam) {
    const res = await fetch(`api/contracts/${idParam}`);
    if (!res.ok) { renderEmpty(); return; }
    contract = await res.json();
  } else {
    const res = await fetch('api/contracts/mine');
    const list = res.ok ? await res.json() : [];
    if (!list.length) { renderEmpty(); return; }
    contract = list[0];
  }

  currentContract = contract;
  render(contract, user);
}

function renderEmpty() {
  el('contractWrap').innerHTML = `
    <div class="empty-state">
      <h2>Nenhum contrato disponível</h2>
      <p>Assim que o fotógrafo cadastrar seu contrato, ele aparece aqui.</p>
    </div>`;
}

function render(contract, user) {
  const isSigned = contract.status === 'signed';
  const eventsHTML = contract.events.map(ev => `
    <div class="contract-event">
      <h3>${ev.title}</h3>
      ${ev.event_date ? `<div class="date">${ev.event_date}</div>` : ''}
      <ul>${ev.items.map(item => `<li>${item}</li>`).join('')}</ul>
    </div>
  `).join('') || '<p style="color:var(--ink-dim); font-size:13px;">Nenhum evento detalhado neste contrato.</p>';

  el('contractWrap').innerHTML = `
    <h1>${contract.title}</h1>
    <span class="contract-status ${isSigned ? 'signed' : 'pending'}">${isSigned ? '✔ Assinado' : '⏳ Aguardando assinatura'}</span>

    ${contract.body ? `<div class="contract-body">${contract.body}</div>` : ''}

    <h2 style="font-size:17px; margin-bottom:12px;">Eventos contratados</h2>
    ${eventsHTML}

    <div id="signatureArea"></div>
  `;

  if (isSigned) {
    el('signatureArea').innerHTML = `
      <div class="signed-block">
        <img src="${contract.signature_data_url}" alt="Assinatura">
        <p style="font-size:13px; color:var(--ink-dim);">Assinado por <b style="color:var(--ink);">${contract.signer_name}</b><br>
        em ${new Date(contract.signed_at).toLocaleString('pt-BR')}</p>
        <button class="btn btn-primary" id="pdfBtn" type="button" style="margin-top:14px;">⬇ Baixar contrato (PDF)</button>
      </div>
    `;
    el('pdfBtn').addEventListener('click', () => downloadPdf(contract));
  } else if (!user.isAdmin) {
    el('signatureArea').innerHTML = `
      <div class="signature-pad-wrap">
        <label>Assine no campo abaixo (use o dedo ou o mouse)</label>
        <canvas id="signaturePad"></canvas>
        <div class="field" style="margin-top:14px;">
          <label>Seu nome completo</label>
          <input type="text" id="signerName" placeholder="Nome como consta no contrato">
        </div>
        <div class="signature-actions">
          <button class="btn btn-ghost" id="clearSignatureBtn" type="button">Limpar</button>
          <button class="btn btn-primary" id="signBtn" type="button">Assinar contrato</button>
        </div>
      </div>
    `;
    setupSignaturePad();
  } else {
    el('signatureArea').innerHTML = `<p style="color:var(--ink-dim); font-size:13px;">Aguardando o cliente assinar.</p>`;
  }
}

// Gera o PDF do contrato no navegador (mesmo conteúdo da versão anterior do servidor)
function downloadPdf(contract) {
  if (!window.jspdf) { alert('Não foi possível gerar o PDF. Recarregue a página.'); return; }
  const doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 56;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  const bottom = doc.internal.pageSize.getHeight() - margin;
  let y = margin;

  function write(text, { size = 11, bold = false, color = 20, gap = 4, indent = 0 } = {}) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines = doc.splitTextToSize(String(text), width - indent);
    for (const line of lines) {
      if (y + size > bottom) { doc.addPage(); y = margin; }
      doc.text(line, margin + indent, y + size);
      y += size + gap;
    }
  }

  write(contract.title, { size: 20, bold: true, gap: 8 });
  y += 8;
  if (contract.body) { write(contract.body, { size: 11, color: 40, gap: 5 }); y += 12; }
  if (contract.events.length) {
    write('Eventos contratados', { size: 14, bold: true, gap: 8 });
    for (const ev of contract.events) {
      write(`${ev.title}${ev.event_date ? '  —  ' + ev.event_date : ''}`, { size: 12, bold: true });
      for (const item of ev.items) write(`•  ${item}`, { size: 11, color: 60, indent: 14 });
      y += 8;
    }
  }
  y += 14;
  write('Assinatura', { size: 13, bold: true, gap: 8 });
  if (contract.status === 'signed') {
    try {
      if (y + 70 > bottom) { doc.addPage(); y = margin; }
      doc.addImage(contract.signature_data_url, 'PNG', margin, y, 180, 60);
      y += 70;
    } catch { /* segue sem a imagem */ }
    write(`Assinado por: ${contract.signer_name}`);
    write(`Data: ${new Date(contract.signed_at).toLocaleString('pt-BR')}`);
  } else {
    write('Contrato ainda não assinado.', { color: 130 });
  }
  doc.save(`${contract.title.replace(/[^\w\-]+/g, '_')}.pdf`);
}

function setupSignaturePad() {
  const canvas = el('signaturePad');
  const ctx = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  canvas.width = canvas.offsetWidth * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  ctx.scale(ratio, ratio);
  ctx.strokeStyle = '#0d1420';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  signaturePad = { canvas, ctx };

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  }

  function start(e) {
    e.preventDefault();
    isDrawing = true;
    hasSignature = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function end() { isDrawing = false; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  el('clearSignatureBtn').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasSignature = false;
  });

  el('signBtn').addEventListener('click', async () => {
    const name = el('signerName').value.trim();
    if (!name) { alert('Digite seu nome completo.'); return; }
    if (!hasSignature) { alert('Faça sua assinatura no campo acima.'); return; }

    const signBtn = el('signBtn');
    signBtn.disabled = true;
    signBtn.textContent = 'Assinando...';

    const signatureDataUrl = canvas.toDataURL('image/png');
    const res = await fetch(`api/contracts/${currentContract.id}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signerName: name, signatureDataUrl })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Erro ao assinar');
      signBtn.disabled = false;
      signBtn.textContent = 'Assinar contrato';
      return;
    }
    loadContract();
  });
}

loadContract();
