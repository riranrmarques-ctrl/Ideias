// Gera dist/dunastudio-worker.js: o worker.js com todas as páginas da pasta site/ embutidas.
// Uso: node build.js   → cole o arquivo gerado no editor do Worker no Cloudflare.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const siteDir = path.join(root, 'site');
const TEXT = new Set(['html', 'css', 'js', 'json', 'svg', 'txt']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.name.startsWith('.')) return [];
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const files = {};
for (const full of walk(siteDir)) {
  const rel = path.relative(siteDir, full).split(path.sep).join('/');
  const ext = path.extname(rel).slice(1).toLowerCase();
  const buf = fs.readFileSync(full);
  const etag = `"${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`;
  files[rel] = TEXT.has(ext) ? { body: buf.toString('utf8'), etag } : { body: buf.toString('base64'), base64: true, etag };
}

const source = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const marker = '/*__SITE_FILES__*/ {}';
if (!source.includes(marker)) throw new Error('Marcador __SITE_FILES__ não encontrado no worker.js');
const out = source.replace(marker, JSON.stringify(files));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'dunastudio-worker.js'), out);
console.log(`dist/dunastudio-worker.js: ${Object.keys(files).length} arquivos, ${(out.length / 1024).toFixed(0)} KB`);
