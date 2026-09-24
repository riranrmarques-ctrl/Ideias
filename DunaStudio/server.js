require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { ensureAdmin } = require('./db');

ensureAdmin(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);

// Caminho onde o site fica publicado (ex: /studio para dunabranding.com.br/studio). Vazio = raiz do domínio.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/+$/, '');

const app = express();
const site = express.Router();
site.use(express.json());
site.use(cookieParser());

// As páginas usam caminhos relativos, então /studio precisa virar /studio/
if (BASE_PATH) {
  app.get('/', (req, res) => res.redirect(BASE_PATH + '/'));
  app.get(BASE_PATH, (req, res, next) => {
    if (req.originalUrl.split('?')[0] === BASE_PATH) return res.redirect(301, BASE_PATH + '/');
    next();
  });
}

site.use(express.static(path.join(__dirname, 'public'), { index: false }));

site.use('/api/auth', require('./routes/auth'));
site.use('/api/videos', require('./routes/videos'));
site.use('/api/albums', require('./routes/albums'));
site.use('/api/contracts', require('./routes/contracts'));
site.use('/api/packages', require('./routes/packages'));
site.use('/api/products', require('./routes/products'));
site.use('/api/testimonials', require('./routes/testimonials'));

// Home pública = portfólio (sem login)
site.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portfolio.html'));
});

// Qualquer rota não-API cai no portfólio (fallback simples)
site.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portfolio.html'));
});

app.use(BASE_PATH || '/', site);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[wedding-flix] Rodando em http://localhost:${PORT}${BASE_PATH}/`);
});
