const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
    });
  }
  return transporter;
}

async function sendSaleNotification(order) {
  const t = getTransporter();
  if (!t) { console.log('[wedding-flix] GMAIL não configurado — pulando e-mail de notificação.'); return; }
  const to = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
  const itemsList = JSON.parse(order.selected_items || '[]').map(i => `- ${i}`).join('\n');

  await t.sendMail({
    from: `"Duna — Vendas" <${process.env.GMAIL_USER}>`,
    to,
    subject: `💰 Novo pagamento aprovado — ${order.package_title}`,
    text: `Pacote: ${order.package_title}\nValor: R$ ${order.total.toFixed(2)}\nCliente: ${order.payer_name || '—'} (${order.payer_email || '—'})\n\nItens:\n${itemsList}\n\nID do pedido: ${order.id}`
  });
}

module.exports = { sendSaleNotification };
