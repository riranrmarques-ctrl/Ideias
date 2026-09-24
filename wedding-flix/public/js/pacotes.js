function formatBRL(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function packageCardHTML(pkg) {
  const itemsListHTML = pkg.items.map(item => `
    <li class="${item.default_included ? 'included' : ''}">
      <span>${item.default_included ? '✓' : '＋'} ${item.label}</span>
      ${item.price > 0 ? `<span class="item-price">${item.default_included ? 'incluso' : '+' + formatBRL(item.price)}</span>` : ''}
    </li>
  `).join('');

  const customizeItemsHTML = pkg.items.map(item => `
    <label class="customize-item">
      <input type="checkbox" data-pkg="${pkg.id}" data-item="${item.id}" data-price="${item.price}" ${item.default_included ? 'checked' : ''}>
      <span class="label">${item.label}</span>
      <span class="price">${formatBRL(item.price)}</span>
    </label>
  `).join('');

  return `
    <div class="package-card" data-package-id="${pkg.id}">
      <h2>${pkg.title}</h2>
      <p class="desc">${pkg.description || ''}</p>
      <div class="package-price">${formatBRL(pkg.basePrice)} <span>pacote padrão</span></div>
      <ul class="package-items-list">${itemsListHTML}</ul>

      <div class="customize-panel" id="customize-${pkg.id}">
        <p style="font-size:12.5px; color:var(--ink-dim); margin-bottom:8px;">Marque ou desmarque os itens pra montar seu pacote:</p>
        ${customizeItemsHTML}
        <div class="package-total">Total: <span id="total-${pkg.id}">${formatBRL(pkg.basePrice)}</span></div>
      </div>

      <div class="checkout-form" id="checkoutForm-${pkg.id}">
        <div class="field"><label>Seu nome</label><input type="text" id="payerName-${pkg.id}" placeholder="Nome completo"></div>
        <div class="field"><label>Seu e-mail</label><input type="email" id="payerEmail-${pkg.id}" placeholder="voce@email.com" required></div>
        <button class="btn btn-primary" style="width:100%; justify-content:center;" onclick="goToPayment(${pkg.id})">Ir para o pagamento →</button>
      </div>

      <div class="package-actions">
        <button class="btn btn-primary" onclick="startCheckout(${pkg.id}, true)">Contratar agora</button>
        <button class="btn btn-ghost" onclick="toggleCustomize(${pkg.id})">Personalizar itens</button>
      </div>
    </div>
  `;
}

async function loadPackages() {
  const res = await fetch('/api/packages');
  const grid = document.getElementById('packagesGrid');
  if (!res.ok) { grid.innerHTML = `<p style="color:var(--ink-dim); padding:0 40px;">Erro ao carregar pacotes.</p>`; return; }
  const packages = await res.json();

  if (!packages.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><h2>Nenhum pacote disponível ainda</h2><p>Em breve os pacotes de serviço aparecem aqui.</p></div>`;
    return;
  }

  grid.innerHTML = packages.map(packageCardHTML).join('');

  // Recalcula o total ao vivo conforme o cliente marca/desmarca itens
  grid.querySelectorAll('.customize-item input').forEach(input => {
    input.addEventListener('change', () => {
      const pkgId = input.dataset.pkg;
      const checkboxes = grid.querySelectorAll(`.customize-item input[data-pkg="${pkgId}"]`);
      let total = 0;
      checkboxes.forEach(cb => { if (cb.checked) total += Number(cb.dataset.price); });
      document.getElementById(`total-${pkgId}`).textContent = formatBRL(total);
    });
  });
}

window.toggleCustomize = (pkgId) => {
  document.getElementById(`customize-${pkgId}`).classList.toggle('open');
};

window.startCheckout = (pkgId, useDefault) => {
  document.getElementById(`checkoutForm-${pkgId}`).classList.add('open');
  document.getElementById(`checkoutForm-${pkgId}`).scrollIntoView({ behavior: 'smooth', block: 'center' });
};

window.goToPayment = async (pkgId) => {
  const name = document.getElementById(`payerName-${pkgId}`).value.trim();
  const email = document.getElementById(`payerEmail-${pkgId}`).value.trim();
  if (!email) { alert('Digite seu e-mail pra continuar.'); return; }

  const card = document.querySelector(`.package-card[data-package-id="${pkgId}"]`);
  const customizeOpen = document.getElementById(`customize-${pkgId}`).classList.contains('open');
  let selectedItemIds = null;
  if (customizeOpen) {
    selectedItemIds = Array.from(card.querySelectorAll('.customize-item input:checked')).map(cb => Number(cb.dataset.item));
  }

  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Redirecionando...';

  try {
    const res = await fetch(`/api/packages/${pkgId}/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedItemIds, payerName: name, payerEmail: email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao iniciar pagamento');
    window.location.href = data.checkoutUrl;
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = 'Ir para o pagamento →';
  }
};

(async () => {
  const user = await trySession();
  document.getElementById('myAreaLink').style.display = user ? 'block' : 'none';
  loadPackages();
})();
