const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'data', 'wedding-flix.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storage_key TEXT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Casamentos',
    poster_url TEXT DEFAULT '',
    hls_url TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'processing',
    duration_seconds INTEGER DEFAULT 0,
    max_quality TEXT DEFAULT '',
    orientation TEXT NOT NULL DEFAULT 'horizontal',
    owner_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    storage_key TEXT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Casamentos',
    cover_url TEXT DEFAULT '',
    cover_r2_key TEXT DEFAULT '',
    owner_user_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    cover_url TEXT DEFAULT '',
    cover_r2_key TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    section_id INTEGER,
    url TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    thumb_url TEXT NOT NULL,
    original_name TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    photo_id INTEGER,
    user_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    signer_name TEXT DEFAULT '',
    signature_data_url TEXT DEFAULT '',
    signed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contract_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    event_date TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    position INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS package_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    default_included INTEGER NOT NULL DEFAULT 1,
    position INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id INTEGER,
    package_title TEXT NOT NULL,
    selected_items TEXT DEFAULT '[]',
    total REAL NOT NULL,
    payer_name TEXT DEFAULT '',
    payer_email TEXT DEFAULT '',
    mp_preference_id TEXT DEFAULT '',
    mp_payment_id TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id INTEGER NOT NULL,
    allow_download INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    position INTEGER DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS product_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER,
    product_title TEXT NOT NULL,
    album_id INTEGER,
    photo_id INTEGER,
    quantity INTEGER NOT NULL DEFAULT 1,
    total REAL NOT NULL,
    payer_name TEXT DEFAULT '',
    payer_email TEXT DEFAULT '',
    mp_preference_id TEXT DEFAULT '',
    mp_payment_id TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS testimonials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    client_name TEXT NOT NULL,
    quote TEXT NOT NULL,
    photo_url TEXT DEFAULT '',
    approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrações leves para bancos criados em versões anteriores
const migrations = [
  "ALTER TABLE videos ADD COLUMN orientation TEXT NOT NULL DEFAULT 'horizontal'",
  "ALTER TABLE videos ADD COLUMN owner_user_id INTEGER",
  "ALTER TABLE videos ADD COLUMN storage_key TEXT",
  "ALTER TABLE photos ADD COLUMN section_id INTEGER",
  "ALTER TABLE photos ADD COLUMN source TEXT NOT NULL DEFAULT 'studio'",
  "ALTER TABLE photos ADD COLUMN uploader_name TEXT DEFAULT ''",
  "ALTER TABLE albums ADD COLUMN guest_upload_enabled INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE albums ADD COLUMN guest_upload_token TEXT"
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (e) { /* coluna já existe — ignora */ }
}

// Preenche storage_key para vídeos antigos que ainda não têm (mantém compatibilidade com uploads já feitos)
const legacyVideos = db.prepare("SELECT id FROM videos WHERE storage_key IS NULL OR storage_key = ''").all();
for (const v of legacyVideos) {
  db.prepare('UPDATE videos SET storage_key = ? WHERE id = ?').run(String(v.id), v.id);
}

function newStorageKey() {
  return crypto.randomUUID();
}

// Cria o admin inicial a partir do .env, caso ainda não exista
function ensureAdmin(email, plainPassword) {
  if (!email || !plainPassword) return;
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return;
  const hash = bcrypt.hashSync(plainPassword, 10);
  db.prepare('INSERT INTO users (email, password_hash, is_admin) VALUES (?, ?, 1)').run(email, hash);
  console.log(`[wedding-flix] Conta admin criada: ${email}`);
}

module.exports = { db, ensureAdmin, newStorageKey };
