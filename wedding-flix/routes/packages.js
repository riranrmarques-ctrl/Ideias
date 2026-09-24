const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { sendSaleNotification } = require('../utils/email');

const router = express.Router();

function loadPackageItems(packageId) {
  return db.prepare('SELECT * FROM package_items WHERE package_id = ? ORDER BY position ASC, id ASC').all(packageId);
}

function fullPackage(pkg) {
  const items = loadPackageItems(pkg.id);
  const basePrice = items.filter(i => i.default_included).reduce((sum, i) => sum + i.price, 0);
  return { ...pkg, items, basePrice };
}

// ---------- Pacotes (públicos — página de contratação) ----------
router.get('/', (req, res) => {
  const packages = db.prepare('SELECT * FROM packages ORDER BY position ASC, id ASC').all();
  res.json(packages.map(fullPackage));
});

router.post('/', requireAdmin, (req, res) => {
  const { title, description, items } = req.body;
  if (!title) return res.status(400).json({ error: 'Título é obrigatório' });
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM packages').get().maxPos + 1;
  const info = db.prepare('INSERT INTO packages (title, description, position) VALUES (?, ?, ?)').run(title, description || '', position);
  const packageId = info.lastInsertRowid;

  (items || []).forEach((item, i) => {
    db.prepare(`
      INSERT INTO package_items (package_id, label, price, default_included, position) VALUES (?, ?, ?, ?, ?)
    `).run(packageId, item.label, Number(item.price) || 0, item.defaultIncluded ? 1 : 0, i);
  });

  res.json({ ok: true, id: packageId });
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM package_items WHERE package_id = ?').run(req.params.id);
  db.prepare('DELETE FROM packages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Checkout (Mercado Pago) ----------
router.post('/:id/checkout', async (req, res) => {
  const pkg = db.prepare('SELECT * FROM packages WHERE id = ?').get(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Pacote não encontrado' });
  const items = loadPackageItems(pkg.id);

  // O cliente manda quais itens quer (personalização); o servidor sempre recalcula o valor — nunca confia no preço vindo do navegador
  const { selectedItemIds, payerName, payerEmail } = req.body;
  const chosenIds = Array.isArray(selectedItemIds) && selectedItemIds.length
    ? selectedItemIds.map(Number)
    : items.filter(i => i.default_included).map(i => i.id);

  const chosenItems = items.filter(i => chosenIds.includes(i.id));
  const total = chosenItems.reduce((sum, i) => sum + i.price, 0);
  if (total <= 0) return res.status(400).json({ error: 'Selecione ao menos um item com valor' });

  if (!process.env.MP_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'Mercado Pago não configurado no servidor (MP_ACCESS_TOKEN ausente no .env)' });
  }

  const orderInfo = db.prepare(`
    INSERT INTO orders (package_id, package_title, selected_items, total, payer_name, payer_email, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `).run(pkg.id, pkg.title, JSON.stringify(chosenItems.map(i => i.label)), total, payerName || '', payerEmail || '');
  const orderId = orderInfo.lastInsertRowid;

  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');

  try {
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        items: [{ title: `${pkg.title} — Duna`, quantity: 1, unit_price: total, currency_id: 'BRL' }],
        payer: payerEmail ? { name: payerName || undefined, email: payerEmail } : undefined,
        external_reference: String(orderId),
        back_urls: {
          success: `${siteUrl}/checkout-sucesso.html`,
          pending: `${siteUrl}/checkout-sucesso.html`,
          failure: `${siteUrl}/pacotes.html`
        },
        auto_return: 'approved',
        notification_url: `${siteUrl}/api/packages/webhook`
      })
    });

    const mpData = await mpRes.json();
    if (!mpRes.ok) {
      console.error('[wedding-flix] Erro Mercado Pago:', mpData);
      return res.status(500).json({ error: 'Erro ao criar preferência de pagamento no Mercado Pago' });
    }

    db.prepare('UPDATE orders SET mp_preference_id = ? WHERE id = ?').run(mpData.id, orderId);
    res.json({ ok: true, checkoutUrl: mpData.init_point });
  } catch (err) {
    console.error('[wedding-flix] Falha ao contatar Mercado Pago:', err);
    res.status(500).json({ error: 'Falha ao contatar o Mercado Pago' });
  }
});

// Mercado Pago chama essa URL quando o status de um pagamento muda
router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // responde rápido — o MP espera 200 mesmo se o processamento continuar depois
  await handleWebhook(req);
});
router.get('/webhook', async (req, res) => {
  res.sendStatus(200);
  await handleWebhook(req);
});

async function handleWebhook(req) {
  try {
    const paymentId = req.body?.data?.id || req.query['data.id'];
    const topic = req.body?.type || req.query.type;
    if (topic !== 'payment' || !paymentId) return;

    const paymentRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` }
    });
    const payment = await paymentRes.json();
    const orderId = payment.external_reference;
    if (!orderId) return;

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return;

    const newStatus = payment.status === 'approved' ? 'approved' : payment.status;
    db.prepare('UPDATE orders SET status = ?, mp_payment_id = ? WHERE id = ?').run(newStatus, String(paymentId), order.id);

    if (newStatus === 'approved' && order.status !== 'approved') {
      const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
      await sendSaleNotification(updated).catch(err => console.error('[wedding-flix] Falha ao enviar e-mail:', err));
    }
  } catch (err) {
    console.error('[wedding-flix] Erro no webhook do Mercado Pago:', err);
  }
}

// Admin: lista pedidos/vendas
router.get('/orders/all', requireAdmin, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(orders);
});

module.exports = router;
