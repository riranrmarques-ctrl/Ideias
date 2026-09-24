const express = require('express');
const PDFDocument = require('pdfkit');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function canAccessContract(contract, user) {
  if (!contract) return false;
  if (user?.isAdmin) return true;
  return contract.owner_user_id === user?.userId;
}

function loadEvents(contractId) {
  const rows = db.prepare('SELECT * FROM contract_events WHERE contract_id = ? ORDER BY position ASC, id ASC').all(contractId);
  return rows.map(e => ({ ...e, items: JSON.parse(e.items || '[]') }));
}

function fullContract(contract) {
  return { ...contract, events: loadEvents(contract.id) };
}

// Admin: lista todos os contratos
router.get('/', requireAdmin, (req, res) => {
  const contracts = db.prepare(`
    SELECT contracts.*, users.email as owner_email
    FROM contracts JOIN users ON users.id = contracts.owner_user_id
    ORDER BY contracts.created_at DESC
  `).all();
  res.json(contracts);
});

// Cliente: vê o(s) próprio(s) contrato(s)
router.get('/mine', requireAuth, (req, res) => {
  const contracts = db.prepare('SELECT * FROM contracts WHERE owner_user_id = ? ORDER BY created_at DESC').all(req.user.userId);
  res.json(contracts.map(fullContract));
});

router.get('/:id', requireAuth, (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract || !canAccessContract(contract, req.user)) return res.status(404).json({ error: 'Contrato não encontrado' });
  res.json(fullContract(contract));
});

// Admin: cria o contrato + eventos contratados de uma vez
// events: [{ title, event_date, items: ["2 fotógrafos", "Álbum 30x30cm", ...] }]
router.post('/', requireAdmin, (req, res) => {
  const { ownerUserId, title, body, events } = req.body;
  if (!ownerUserId || !title) return res.status(400).json({ error: 'Cliente e título são obrigatórios' });

  const info = db.prepare(`
    INSERT INTO contracts (owner_user_id, title, body) VALUES (?, ?, ?)
  `).run(Number(ownerUserId), title, body || '');
  const contractId = info.lastInsertRowid;

  (events || []).forEach((ev, i) => {
    db.prepare(`
      INSERT INTO contract_events (contract_id, title, event_date, items, position) VALUES (?, ?, ?, ?, ?)
    `).run(contractId, ev.title, ev.event_date || '', JSON.stringify(ev.items || []), i);
  });

  res.json({ ok: true, id: contractId });
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM contract_events WHERE contract_id = ?').run(req.params.id);
  db.prepare('DELETE FROM contracts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Cliente dono assina — nome digitado + assinatura desenhada (PNG em base64)
router.post('/:id/sign', requireAuth, (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract || contract.owner_user_id !== req.user.userId) return res.status(403).json({ error: 'Sem acesso a este contrato' });
  if (contract.status === 'signed') return res.status(400).json({ error: 'Este contrato já foi assinado' });

  const { signerName, signatureDataUrl } = req.body;
  if (!signerName || !signatureDataUrl) return res.status(400).json({ error: 'Nome e assinatura são obrigatórios' });

  db.prepare(`
    UPDATE contracts SET status = 'signed', signer_name = ?, signature_data_url = ?, signed_at = datetime('now') WHERE id = ?
  `).run(signerName, signatureDataUrl, contract.id);

  res.json({ ok: true });
});

// Gera o PDF do contrato (com a assinatura, se já assinado)
router.get('/:id/pdf', requireAuth, (req, res) => {
  const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  if (!contract || !canAccessContract(contract, req.user)) return res.status(404).end();
  const events = loadEvents(contract.id);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${contract.title.replace(/[^\w\-]+/g, '_')}.pdf"`);

  const doc = new PDFDocument({ margin: 56 });
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(20).text(contract.title);
  doc.moveDown(0.6);

  if (contract.body) {
    doc.font('Helvetica').fontSize(11).fillColor('#222').text(contract.body, { align: 'left', lineGap: 3 });
    doc.moveDown(1);
  }

  if (events.length) {
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text('Eventos contratados');
    doc.moveDown(0.4);
    for (const ev of events) {
      doc.font('Helvetica-Bold').fontSize(12).text(`${ev.title}${ev.event_date ? '  —  ' + ev.event_date : ''}`);
      doc.font('Helvetica').fontSize(11).fillColor('#333');
      for (const item of ev.items) {
        doc.text(`•  ${item}`, { indent: 14 });
      }
      doc.fillColor('#000');
      doc.moveDown(0.6);
    }
  }

  doc.moveDown(1.2);
  doc.font('Helvetica-Bold').fontSize(13).text('Assinatura');
  doc.moveDown(0.3);

  if (contract.status === 'signed') {
    try {
      const base64 = contract.signature_data_url.split(',')[1];
      const imgBuffer = Buffer.from(base64, 'base64');
      doc.image(imgBuffer, { width: 180 });
    } catch (e) { /* segue sem a imagem se falhar */ }
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(11).text(`Assinado por: ${contract.signer_name}`);
    doc.text(`Data: ${new Date(contract.signed_at).toLocaleString('pt-BR')}`);
  } else {
    doc.font('Helvetica').fontSize(11).fillColor('#888').text('Contrato ainda não assinado.');
  }

  doc.end();
});

module.exports = router;
