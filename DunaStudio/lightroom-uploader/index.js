const fs = require('fs');
const path = require('path');
const readline = require('readline');
const sharp = require('sharp');

// ---------- Carrega o .env manualmente (sem dependências externas) ----------
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Falta o arquivo .env — copie o .env.example pra .env e preencha os dados.');
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

const env = loadEnv();
const SERVER_URL = env.SERVER_URL.replace(/\/$/, '');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp'];

// Login pelo Supabase (o mesmo e-mail e senha de admin do site)
let session = null;
let supabaseConfig = null;

async function supabaseToken(body, grantType) {
  const res = await fetch(`${supabaseConfig.supabaseUrl}/auth/v1/token?grant_type=${grantType}`, {
    method: 'POST',
    headers: { apikey: supabaseConfig.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || `HTTP ${res.status}`);
  return data;
}

async function login() {
  const cfgRes = await fetch(`${SERVER_URL}/api/config`).catch(() => null);
  if (!cfgRes || !cfgRes.ok) { console.error(`Não consegui falar com ${SERVER_URL}. Confira o SERVER_URL no .env.`); process.exit(1); }
  supabaseConfig = await cfgRes.json();
  try {
    session = await supabaseToken({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }, 'password');
  } catch (err) {
    console.error(`Falha no login (${err.message}). Confira ADMIN_EMAIL e ADMIN_PASSWORD no .env.`);
    process.exit(1);
  }
  console.log('✔ Login feito com sucesso.\n');
}

// Chamada à API com o token; renova o login sozinho quando o token vence (a cada ~1h)
async function api(pathAndQuery, options = {}, retry = true) {
  const res = await fetch(`${SERVER_URL}/${pathAndQuery}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${session.access_token}` }
  });
  if (res.status === 401 && retry) {
    session = await supabaseToken({ refresh_token: session.refresh_token }, 'refresh_token')
      .catch(() => supabaseToken({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD }, 'password'));
    return api(pathAndQuery, options, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function pickAlbum() {
  const albums = await api('api/albums');
  if (!albums.length) {
    console.error('Nenhum álbum cadastrado ainda. Crie um no painel admin primeiro.');
    process.exit(1);
  }
  console.log('Álbuns disponíveis:\n');
  albums.forEach((a, i) => console.log(`  ${i + 1}. ${a.title} (${a.category})`));
  console.log('');
  const choice = await ask('Digite o número do álbum pra onde as fotos vão: ');
  const album = albums[Number(choice) - 1];
  if (!album) { console.error('Opção inválida.'); process.exit(1); }
  return album;
}

async function pickSection(albumId) {
  const detail = await api(`api/albums/${albumId}`);
  if (!detail.sections.length) return null;
  console.log('\nSeções do álbum:\n');
  detail.sections.forEach((s, i) => console.log(`  ${i + 1}. ${s.title}`));
  const choice = await ask('Número da seção (Enter = fotos gerais, sem seção): ');
  return detail.sections[Number(choice) - 1] || null;
}

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.webp': 'image/webp' };

async function uploadFile(albumId, sectionId, filePath) {
  const buffer = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const params = new URLSearchParams({ name: filename });
  if (sectionId) params.set('section', String(sectionId));

  // 1) foto original  2) miniatura de 900px, que registra a foto no álbum
  const { key } = await api(`api/albums/${albumId}/files?kind=photo&${params}`, {
    method: 'PUT', headers: { 'Content-Type': MIME[path.extname(filename).toLowerCase()] || 'application/octet-stream' }, body: buffer
  });
  const thumb = await sharp(buffer).rotate().resize(900, 900, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  params.set('for', key);
  await api(`api/albums/${albumId}/files?kind=thumb&${params}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: thumb });
}

// Espera o arquivo "parar de crescer" antes de subir — evita pegar um export ainda sendo escrito
async function waitUntilStable(filePath, tries = 10) {
  let lastSize = -1;
  for (let i = 0; i < tries; i++) {
    if (!fs.existsSync(filePath)) return false;
    const size = fs.statSync(filePath).size;
    if (size === lastSize && size > 0) return true;
    lastSize = size;
    await new Promise(r => setTimeout(r, 500));
  }
  return true;
}

async function watchFolder(folderPath, albumId, sectionId) {
  const uploadedDir = path.join(folderPath, '_enviado');
  if (!fs.existsSync(uploadedDir)) fs.mkdirSync(uploadedDir);

  const processing = new Set();

  async function handleFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    if (!IMAGE_EXTENSIONS.includes(ext)) return;
    const fullPath = path.join(folderPath, filename);
    if (!fs.existsSync(fullPath) || processing.has(filename)) return;
    processing.add(filename);

    const stable = await waitUntilStable(fullPath);
    if (!stable || !fs.existsSync(fullPath)) { processing.delete(filename); return; }

    try {
      await uploadFile(albumId, sectionId, fullPath);
      fs.renameSync(fullPath, path.join(uploadedDir, filename));
      console.log(`✔ Enviado: ${filename}`);
    } catch (err) {
      console.log(`✗ Falhou: ${filename} — ${err.message}`);
    } finally {
      processing.delete(filename);
    }
  }

  console.log(`\n👀 Vigiando: ${folderPath}`);
  console.log('Exporte as fotos do Lightroom pra essa pasta — elas sobem sozinhas.');
  console.log('Pressione Ctrl+C pra parar.\n');

  // Sobe o que já estiver na pasta na hora que o script começar
  const existing = fs.readdirSync(folderPath).filter(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()));
  for (const f of existing) await handleFile(f);

  fs.watch(folderPath, (eventType, filename) => {
    if (filename) handleFile(filename);
  });
}

(async () => {
  console.log('=== DunaStudio — Upload automático do Lightroom ===\n');
  await login();
  const album = await pickAlbum();
  const section = await pickSection(album.id);
  console.log(`\nÁlbum escolhido: ${album.title}${section ? ` → ${section.title}` : ''}\n`);

  const defaultFolder = path.join(require('os').homedir(), 'Desktop', 'Exportar-DunaStudio');
  const folderInput = await ask(`Pasta pra vigiar (Enter pra usar "${defaultFolder}"): `);
  const folderPath = folderInput.trim() || defaultFolder;

  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

  rl.close();
  await watchFolder(folderPath, album.id, section ? section.id : null);
})();
