const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

let sessionCookie = null;

async function login() {
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD })
  });
  if (!res.ok) {
    console.error('Falha no login. Confira ADMIN_EMAIL/ADMIN_PASSWORD no .env.');
    process.exit(1);
  }
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) { console.error('Login não retornou sessão.'); process.exit(1); }
  sessionCookie = setCookie.split(';')[0]; // "token=xxxxx"
  console.log('✔ Login feito com sucesso.\n');
}

async function fetchAlbums() {
  const res = await fetch(`${SERVER_URL}/api/albums`, { headers: { Cookie: sessionCookie } });
  if (!res.ok) { console.error('Não foi possível listar os álbuns.'); process.exit(1); }
  return res.json();
}

async function pickAlbum() {
  const albums = await fetchAlbums();
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

async function uploadFile(albumId, filePath) {
  const buffer = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.webp': 'image/webp' };

  const form = new FormData();
  form.append('photos', new Blob([buffer], { type: mimeMap[ext] || 'application/octet-stream' }), filename);

  const res = await fetch(`${SERVER_URL}/api/albums/${albumId}/photos`, {
    method: 'POST',
    headers: { Cookie: sessionCookie },
    body: form
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
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

async function watchFolder(folderPath, albumId) {
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
      await uploadFile(albumId, fullPath);
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
  console.log('=== Wedding Flix — Upload automático do Lightroom ===\n');
  await login();
  const album = await pickAlbum();
  console.log(`\nÁlbum escolhido: ${album.title}\n`);

  const defaultFolder = path.join(require('os').homedir(), 'Desktop', 'Exportar-WeddingFlix');
  const folderInput = await ask(`Pasta pra vigiar (Enter pra usar "${defaultFolder}"): `);
  const folderPath = folderInput.trim() || defaultFolder;

  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

  rl.close();
  await watchFolder(folderPath, album.id);
})();
