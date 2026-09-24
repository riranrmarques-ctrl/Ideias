const express = require('express');
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { sendSaleNotification } = require('../utils/email');

const router = express.Router();

router.get('/', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY position ASC, id ASC').all();
  res.json(products);
});

router.post('/', requireAdmin, (req, res) => {
  const { title, description, price } = req.body;
  if (!title || !price) return res.status(400).json({ error: 'Título e preço são obrigatórios' });
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM products').get().maxPos + 1;
  const info = db.prepare('INSERT INTO products (title, description, price, position) VALUES (?, ?, ?, ?)')
    .run(title, description || '', Number(price), position);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Pedido de produto físico — opcionalmente vinculado a uma foto/álbum específico
router.post('/:id/order', async (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produto não encontrado' });
  if (!process.env.MP_ACCESS_TOKEN) return res.status(500).json({ error: 'Mercado Pago não configurado no servidor' });

  const { photoId, albumId, quantity, payerName, payerEmail } = req.body;
  const qty = Math.max(1, Number(quantity) || 1);
  const total = product.price * qty;

  const orderInfo = db.prepare(`
    INSERT INTO product_orders (product_id, product_title, album_id, photo_id, quantity, total, payer_name, payer_email, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(product.id, product.title, albumId || null, photoId || null, qty, total, payerName || '', payerEmail || '');
  const orderId = orderInfo.lastInsertRowid;

  const siteUrl = (process.env.SITE_URL || '').replace(/\/$/, '');
  try {
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
      body: JSON.stringify({
        items: [{ title: `${product.title} — Duna`, quantity: qty, unit_price: product.price, currency_id: 'BRL' }],
        payer: payerEmail ? { name: payerName || undefined, email: payerEmail } : undefined,
        external_reference: `product-${orderId}`,
        back_urls: {
          success: `${siteUrl}/checkout-sucesso.html`,
          pending: `${siteUrl}/checkout-sucesso.html`,
          failure: `${siteUrl}/`
        },
        auto_return: 'approved',
        notification_url: `${siteUrl}/api/products/webhook`
      })
    });
    const mpData = await mpRes.json();
    if (!mpRes.ok) return res.status(500).json({ error: 'Erro ao criar preferência de pagamento' });
    db.prepare('UPDATE product_orders SET mp_preference_id = ? WHERE id = ?').run(mpData.id, orderId);
    res.json({ ok: true, checkoutUrl: mpData.init_point });
  } catch (err) {
    console.error('[wedding-flix] Falha ao contatar Mercado Pago (produtos):', err);
    res.status(500).json({ error: 'Falha ao contatar o Mercado Pago' });
  }
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
    const ref = payment.external_reference || '';
    if (!ref.startsWith('product-')) return;
    const orderId = ref.replace('product-', '');

    const order = db.prepare('SELECT * FROM product_orders WHERE id = ?').get(orderId);
    if (!order) return;
    const newStatus = payment.status === 'approved' ? 'approved' : payment.status;
    db.prepare('UPDATE product_orders SET status = ?, mp_payment_id = ? WHERE id = ?').run(newStatus, String(paymentId), order.id);

    if (newStatus === 'approved' && order.status !== 'approved') {
      const updated = db.prepare('SELECT * FROM product_orders WHERE id = ?').get(order.id);
      await sendSaleNotification({
        id: updated.id,
        package_title: `Produto físico: ${updated.product_title} (x${updated.quantity})`,
        total: updated.total,
        payer_name: updated.payer_name,
        payer_email: updated.payer_email,
        selected_items: '[]'
      }).catch(err => console.error('[wedding-flix] Falha ao enviar e-mail:', err));
    }
  } catch (err) {
    console.error('[wedding-flix] Erro no webhook de produtos:', err);
  }
}
router.post('/webhook', async (req, res) => { res.sendStatus(200); await handleWebhook(req); });
router.get('/webhook', async (req, res) => { res.sendStatus(200); await handleWebhook(req); });

router.get('/orders/all', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM product_orders ORDER BY created_at DESC').all());
});

module.exports = router;
