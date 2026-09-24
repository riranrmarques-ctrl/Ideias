require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { ensureAdmin } = require('./db');

ensureAdmin(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/videos', require('./routes/videos'));
app.use('/api/albums', require('./routes/albums'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/packages', require('./routes/packages'));
app.use('/api/products', require('./routes/products'));
app.use('/api/testimonials', require('./routes/testimonials'));

// Home pública = portfólio (sem login)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portfolio.html'));
});

// Qualquer rota não-API cai no portfólio (fallback simples)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portfolio.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[wedding-flix] Rodando em http://localhost:${PORT}`);
});
