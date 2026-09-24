const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Informe email e senha' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Email ou senha incorretos' });

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Email ou senha incorretos' });

  const token = jwt.sign(
    { userId: user.id, email: user.email, isAdmin: !!user.is_admin },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: (process.env.BASE_PATH || '').replace(/\/+$/, '') || '/'
  });

  res.json({ ok: true, isAdmin: !!user.is_admin, email: user.email });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: (process.env.BASE_PATH || '').replace(/\/+$/, '') || '/' });
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const jwtLib = require('jsonwebtoken');
    const payload = jwtLib.verify(token, JWT_SECRET);
    res.json({ email: payload.email, isAdmin: payload.isAdmin });
  } catch {
    res.status(401).json({ error: 'Sessão inválida' });
  }
});

// Admin cria contas de clientes
router.post('/users', require('../middleware/auth').requireAdmin, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Email e senha (mín. 6 caracteres) são obrigatórios' });
  }
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (email, password_hash, is_admin) VALUES (?, ?, 0)')
      .run(email.toLowerCase().trim(), hash);
    res.json({ ok: true });
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Este email já está cadastrado' });
    }
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

router.get('/users', require('../middleware/auth').requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, is_admin, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

router.delete('/users/:id', require('../middleware/auth').requireAdmin, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ? AND is_admin = 0').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
