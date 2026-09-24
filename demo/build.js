const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'pages') + '/';
const read = (f) => fs.readFileSync(D + f, 'utf8');
const pages = ['portfolio.html','minha-area.html','login.html','album.html','watch.html','admin.html','contract.html',
  'pacotes.html','checkout-sucesso.html','compartilhado.html','convidados.html','depoimento.html'];
const fixNav = (js) => js.replace(/window\.location\.href = ([^;]+);/g, '__demoGo($1);');
const esc = (s) => s.replace(/<\/(script)/gi, '<\\/$1');
let entries = [];
for (const p of pages) {
  const html = read(p);
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || 'Duna';
  let body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'));
  const scripts = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    const src = (m[1].match(/src="([^"]+)"/) || [])[1];
    if (src) { if (src.startsWith('js/') && src !== 'js/mock-api.js') scripts.push(`// ${src}\n` + read(src)); }
    else scripts.push(m[2]);
  }
  body = body.replace(re, '').trim();
  entries.push(`${JSON.stringify(p)}: { title: ${JSON.stringify(title)}, body: ${esc(JSON.stringify(body))}, run: function () {\n${esc(fixNav(scripts.join('\n;\n')))}\n} }`);
}
entries.push(`"demo": { title: "Duna Wedding Flix", body: ${esc(JSON.stringify(fs.readFileSync(path.join(__dirname, 'hub-body.html'), 'utf8')))}, run: function () {} }`);
const logo = 'data:image/png;base64,' + fs.readFileSync(D + 'img/logo-duna.png').toString('base64');
const out = `<title>Duna Wedding Flix</title>
<style>
${read('css/styles.css')}
:root { color-scheme: dark; }
body { background: #0d1420; padding-bottom: 64px; }
#demoBar{position:fixed;left:0;right:0;bottom:0;z-index:9000;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 10px;
  padding:8px 16px calc(8px + env(safe-area-inset-bottom,0px));background:rgba(21,31,46,.96);border-top:1px solid #2a3a52;
  font:500 12.5px/1.3 Inter,system-ui,sans-serif;color:#8ea0b8;backdrop-filter:blur(6px)}
#demoBar[hidden]{display:none}
#demoBar b{color:#eef3f9;font-weight:600}
#demoBar .seg{display:inline-flex;border:1px solid #2a3a52;border-radius:6px;overflow:hidden}
#demoBar button{background:none;color:#8ea0b8;padding:6px 10px;border-radius:0;font:inherit;cursor:pointer}
#demoBar button[aria-pressed="true"]{background:#5b9bd9;color:#0d1420}
#demoBar button:focus-visible{outline:2px solid #5b9bd9;outline-offset:1px}
#demoBar .reset{border:1px solid #2a3a52;border-radius:6px}
${fs.readFileSync(path.join(__dirname, 'hub.css'), 'utf8')}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.15/hls.min.js"></script>
<div id="app"></div>
<script>window.__LOGO = ${JSON.stringify(logo)};</script>
<script>
${esc(read('js/mock-api.js'))}
</script>
<script>
window.__PAGES = {
${entries.join(',\n')}
};
window.__demoStart();
</script>
`;
// out = versão fragmento (usada como Artifact no claude.ai)

const full = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${out.slice(0, out.indexOf('<div id="app">'))}</head>
<body>
${out.slice(out.indexOf('<div id="app">'))}</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'index.html'), full);
console.log('docs/index.html gerado', full.length, 'bytes');
