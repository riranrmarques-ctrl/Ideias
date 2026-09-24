const express = require('express');
const { db } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Público — só os aprovados, pro portfólio
router.get('/portfolio', (req, res) => {
  const rows = db.prepare('SELECT client_name, quote, photo_url FROM testimonials WHERE approved = 1 ORDER BY created_at DESC').all();
  res.json(rows);
});

// Admin — vê todos (aprovados e pendentes)
router.get('/', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT testimonials.*, users.email as owner_email
    FROM testimonials JOIN users ON users.id = testimonials.owner_user_id
    ORDER BY testimonials.created_at DESC
  `).all();
  res.json(rows);
});

// Cliente envia o depoimento (depois da entrega)
router.post('/', requireAuth, (req, res) => {
  const { clientName, quote, photoUrl } = req.body;
  if (!clientName || !quote) return res.status(400).json({ error: 'Nome e depoimento são obrigatórios' });
  const info = db.prepare(`
    INSERT INTO testimonials (owner_user_id, client_name, quote, photo_url) VALUES (?, ?, ?, ?)
  `).run(req.user.userId, clientName, quote, photoUrl || '');
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.patch('/:id/approve', requireAdmin, (req, res) => {
  db.prepare('UPDATE testimonials SET approved = 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM testimonials WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
