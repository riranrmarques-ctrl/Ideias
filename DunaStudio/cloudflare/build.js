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
const dist = path.join(root, 'dist');
fs.mkdirSync(path.join(dist, 'partes'), { recursive: true });

// 1) Arquivo único
const single = source.replace(marker, JSON.stringify(files));
fs.writeFileSync(path.join(dist, 'dunastudio-worker.js'), single);
console.log(`dist/dunastudio-worker.js: ${Object.keys(files).length} arquivos, ${(single.length / 1024).toFixed(0)} KB`);

// 2) Três partes para colar no editor do Cloudflare: worker.js (API) + paginas.js (HTML, CSS e imagens) + scripts.js (JS)
const paginas = {}, scripts = {};
for (const [name, file] of Object.entries(files)) {
  (/\.js$/.test(name) ? scripts : paginas)[name] = file;
}
const header = (title) => `// DunaStudio — ${title}\n// Parte gerada por build.js. Não edite à mão: altere a pasta site/ e gere de novo.\n`;
const partes = {
  'worker.js': `import PAGINAS from './paginas.js';\nimport SCRIPTS from './scripts.js';\n\n` + source.replace(marker, '{ ...PAGINAS, ...SCRIPTS }'),
  'paginas.js': header('páginas, estilos e imagens do site') + `export default ${JSON.stringify(paginas)};\n`,
  'scripts.js': header('scripts do site') + `export default ${JSON.stringify(scripts)};\n`
};
for (const [name, content] of Object.entries(partes)) {
  fs.writeFileSync(path.join(dist, 'partes', name), content);
  console.log(`dist/partes/${name}: ${(content.length / 1024).toFixed(0)} KB`);
}
