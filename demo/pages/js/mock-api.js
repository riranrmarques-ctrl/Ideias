// Backend simulado para a demonstração estática do Wedding Flix.
// Intercepta todas as chamadas a /api/* e responde com dados de exemplo guardados no navegador.
(function () {
  'use strict';

  // ---------- Armazenamento (localStorage com fallback em window.name) ----------
  const KEY = 'wfdemo_v1';
  function readStore() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch {}
    try { if (window.name && window.name.startsWith('{"wfdemo"')) return JSON.parse(window.name).wfdemo; } catch {}
    return null;
  }
  function writeStore(data) {
    const json = JSON.stringify(data);
    try { localStorage.setItem(KEY, json); return; } catch {}
    try { window.name = JSON.stringify({ wfdemo: data }); } catch {}
  }

  // ---------- Imagens geradas (SVG) ----------
  const PALETTES = [
    ['#23324a', '#e9a97e', '#f6d6b8'], ['#1c2a38', '#9fb8c9', '#e6eef3'], ['#3a2a3c', '#e8a595', '#f7dcd2'],
    ['#12302f', '#86b9aa', '#dcefe7'], ['#3b2319', '#d9ae84', '#f3e2cc'], ['#1f2240', '#a58bc9', '#e7dcf3'],
    ['#2c2a22', '#cdb67e', '#f2ead0'], ['#2a1d24', '#c98a9e', '#f4d9e1']
  ];
  function rng(seed) { let s = (seed * 9301 + 49297) % 233280 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
  const imgCache = {};
  function scene(seed, w, h, withCouple) {
    const k = seed + ':' + w + ':' + h + ':' + withCouple;
    if (imgCache[k]) return imgCache[k];
    const r = rng(seed + 7);
    const [dark, mid, light] = PALETTES[seed % PALETTES.length];
    const sunX = Math.round(w * (0.25 + r() * 0.5)), sunY = Math.round(h * (0.35 + r() * 0.2));
    let bokeh = '';
    for (let i = 0; i < 9; i++) {
      bokeh += `<circle cx="${Math.round(r() * w)}" cy="${Math.round(r() * h * 0.7)}" r="${Math.round(10 + r() * w * 0.05)}" fill="${light}" opacity="${(0.08 + r() * 0.2).toFixed(2)}"/>`;
    }
    const hill = `M0 ${h * 0.72} C ${w * 0.3} ${h * (0.6 + r() * 0.1)}, ${w * 0.6} ${h * (0.78 + r() * 0.08)}, ${w} ${h * 0.66} L ${w} ${h} L 0 ${h} Z`;
    let couple = '';
    if (withCouple) {
      const cx = Math.round(w * (0.35 + r() * 0.3)), base = Math.round(h * 0.8), s = h / 520;
      couple = `<g fill="${dark}" opacity="0.92">
        <circle cx="${cx - 16 * s}" cy="${base - 150 * s}" r="${13 * s}"/>
        <path d="M${cx - 30 * s} ${base} L${cx - 26 * s} ${base - 132 * s} Q${cx - 16 * s} ${base - 142 * s} ${cx - 6 * s} ${base - 132 * s} L${cx - 2 * s} ${base} Z"/>
        <circle cx="${cx + 14 * s}" cy="${base - 140 * s}" r="${12 * s}"/>
        <path d="M${cx - 8 * s} ${base} Q${cx + 14 * s} ${base - 150 * s} ${cx + 16 * s} ${base - 124 * s} Q${cx + 20 * s} ${base - 150 * s} ${cx + 44 * s} ${base} Z"/>
      </g>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset="0.62" stop-color="${mid}"/><stop offset="1" stop-color="${light}"/></linearGradient>
      <filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${Math.round(w / 60)}"/></filter></defs>
      <rect width="${w}" height="${h}" fill="url(#g)"/>
      <circle cx="${sunX}" cy="${sunY}" r="${Math.round(w * 0.09)}" fill="${light}" opacity="0.85" filter="url(#b)"/>
      <g filter="url(#b)">${bokeh}</g>
      <path d="${hill}" fill="${dark}" opacity="0.55"/>
      ${couple}
    </svg>`;
    return (imgCache[k] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  }
  const poster = (seed) => scene(seed, 960, 540, true);
  const photo = (seed, vertical) => vertical ? scene(seed, 600, 800, seed % 3 === 0) : scene(seed, 800, 534, seed % 3 === 0);

  // ---------- Dados de exemplo ----------
  const now = Date.now();
  const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

  function seedData() {
    const users = [
      { id: 1, email: 'admin@duna.demo', password: 'demo123', is_admin: 1, created_at: daysAgo(400) },
      { id: 2, email: 'ana.pedro@email.com', password: 'demo123', is_admin: 0, created_at: daysAgo(60) },
      { id: 3, email: 'julia.rafael@email.com', password: 'demo123', is_admin: 0, created_at: daysAgo(12) }
    ];
    const videos = [
      { id: 1, title: 'Marina & Lucas', description: 'Um fim de tarde na Fazenda Santa Bárbara, em Itu. Trailer do casamento.', category: 'Casamentos', status: 'ready', duration_seconds: 372, max_quality: '4K', orientation: 'horizontal', owner_user_id: null, seed: 11 },
      { id: 2, title: 'Clara & Tomás', description: 'Cerimônia ao ar livre na Serra da Mantiqueira.', category: 'Casamentos', status: 'ready', duration_seconds: 415, max_quality: '4K', orientation: 'horizontal', owner_user_id: null, seed: 12 },
      { id: 3, title: 'Helena & Caio', description: 'Casamento na praia, com a luz dourada de Paraty.', category: 'Casamentos', status: 'ready', duration_seconds: 298, max_quality: '1080p', orientation: 'horizontal', owner_user_id: null, seed: 13 },
      { id: 4, title: 'Beatriz & João em Trancoso', description: 'Três dias de celebração no Quadrado.', category: 'Destination weddings', status: 'ready', duration_seconds: 540, max_quality: '4K', orientation: 'horizontal', owner_user_id: null, seed: 14 },
      { id: 5, title: 'Lívia & André em Lisboa', description: 'Elopement nos miradouros de Alfama.', category: 'Destination weddings', status: 'ready', duration_seconds: 262, max_quality: '4K', orientation: 'horizontal', owner_user_id: null, seed: 15 },
      { id: 6, title: 'Pré-wedding Sofia & Davi', description: 'Ensaio no Jardim Botânico do Rio.', category: 'Ensaios', status: 'ready', duration_seconds: 184, max_quality: '1080p', orientation: 'horizontal', owner_user_id: null, seed: 16 },
      { id: 7, title: 'Ana & Pedro — Filme completo', description: 'O filme completo do casamento de vocês, da preparação à última música.', category: 'Seu casamento', status: 'ready', duration_seconds: 4320, max_quality: '4K', orientation: 'horizontal', owner_user_id: 2, seed: 21 },
      { id: 8, title: 'Ana & Pedro — Trailer', description: 'Os melhores momentos em 5 minutos.', category: 'Seu casamento', status: 'ready', duration_seconds: 305, max_quality: '4K', orientation: 'horizontal', owner_user_id: 2, seed: 22 },
      { id: 9, title: 'Julia & Rafael — Filme completo', description: 'Em edição.', category: 'Seu casamento', status: 'processing', duration_seconds: 0, max_quality: '', orientation: 'horizontal', owner_user_id: 3, seed: 23, created_ms: now }
    ];
    let pid = 1, sid = 1;
    const photos = [], sections = [];
    function addSection(albumId, title, description, count, seedBase) {
      const s = { id: sid++, album_id: albumId, title, description, seed: seedBase };
      sections.push(s);
      for (let i = 0; i < count; i++) photos.push({ id: pid++, album_id: albumId, section_id: s.id, seed: seedBase + i, vertical: i % 4 === 1, source: 'studio' });
      return s;
    }
    const albums = [
      { id: 1, title: 'Marina & Lucas — Fazenda Santa Bárbara', description: 'Itu, SP · 12 de abril de 2026', category: 'Casamentos', owner_user_id: null, seed: 31 },
      { id: 2, title: 'Clara & Tomás — Mantiqueira', description: 'Gonçalves, MG · 3 de maio de 2026', category: 'Casamentos', owner_user_id: null, seed: 41 },
      { id: 3, title: 'Ana & Pedro — Álbum completo', description: 'Espaço Villa Bisutti, São Paulo · 14 de junho de 2026', category: 'Casamentos', owner_user_id: 2, seed: 51, guest_upload_enabled: 1, guest_upload_token: 'convidados-ana-pedro' },
      { id: 4, title: 'Julia & Rafael — Prévia', description: 'As primeiras 12 fotos, enquanto o álbum completo fica pronto.', category: 'Casamentos', owner_user_id: 3, seed: 61 }
    ];
    addSection(1, 'Making-of', 'A manhã da noiva', 8, 100);
    addSection(1, 'Cerimônia', '', 12, 120);
    for (let i = 0; i < 6; i++) photos.push({ id: pid++, album_id: 1, section_id: null, seed: 140 + i, vertical: i % 3 === 0, source: 'studio' });
    for (let i = 0; i < 14; i++) photos.push({ id: pid++, album_id: 2, section_id: null, seed: 160 + i, vertical: i % 4 === 2, source: 'studio' });
    addSection(3, 'Making-of', 'Preparação dos noivos', 9, 200);
    addSection(3, 'Cerimônia', 'O sim, às 17h', 12, 220);
    addSection(3, 'Recepção', 'A festa até de madrugada', 12, 240);
    const guest = addSection(3, 'Fotos dos convidados', 'Enviadas pelos convidados durante a festa', 4, 260);
    photos.filter(p => p.section_id === guest.id).forEach(p => { p.source = 'guest'; p.uploader_name = 'Tia Marta'; });
    for (let i = 0; i < 12; i++) photos.push({ id: pid++, album_id: 4, section_id: null, seed: 300 + i, vertical: i % 4 === 3, source: 'studio' });

    const signature = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><path d="M20 80 C 40 20, 60 20, 70 70 S 100 110, 120 60 S 150 20, 170 70 C 180 90, 200 90, 215 55 C 230 25, 250 95, 270 60 S 320 40, 380 70" fill="none" stroke="#0d1420" stroke-width="3" stroke-linecap="round"/></svg>');

    return {
      nextId: 1000,
      users, videos, albums, sections, photos,
      comments: [
        { id: 1, album_id: 3, user_id: 2, body: 'Chorei de novo vendo a cerimônia! Obrigada por tudo ❤️', created_at: daysAgo(3) },
        { id: 2, album_id: 3, user_id: 1, body: 'Que bom que gostaram! O álbum impresso entra em produção na semana que vem.', created_at: daysAgo(2) }
      ],
      contracts: [
        { id: 1, owner_user_id: 2, title: 'Contrato de cobertura — Ana & Pedro', status: 'signed', signer_name: 'Ana Carolina Souza', signature_data_url: signature, signed_at: daysAgo(150),
          body: 'O ESTÚDIO DUNA se compromete a realizar a cobertura foto e vídeo do casamento nas datas e condições descritas abaixo. O material editado será entregue em até 90 dias pela plataforma online.',
          events: [
            { title: 'Cerimônia', event_date: '14/06/2026', items: ['2 fotógrafos', '1 cinegrafista', 'Drone'] },
            { title: 'Recepção', event_date: '14/06/2026', items: ['Cobertura até 2h', 'Filme completo em 4K', 'Trailer de 5 minutos'] }
          ] },
        { id: 2, owner_user_id: 3, title: 'Contrato de cobertura — Julia & Rafael', status: 'pending', signer_name: '', signature_data_url: '', signed_at: null,
          body: 'O ESTÚDIO DUNA se compromete a realizar a cobertura foto e vídeo do casamento nas datas e condições descritas abaixo. Sinal de 30% na assinatura e saldo até 15 dias antes do evento.',
          events: [
            { title: 'Pré-wedding', event_date: '20/10/2026', items: ['Ensaio de 2h', '60 fotos editadas'] },
            { title: 'Cerimônia e recepção', event_date: '14/11/2026', items: ['2 fotógrafos', '1 cinegrafista', 'Álbum impresso 30x30cm', 'Making-of incluso'] }
          ] }
      ],
      packages: [
        { id: 1, title: 'Essencial', description: 'Para casamentos intimistas, de até 80 convidados.', items: [
          { id: 1, label: 'Fotografia (6h de cobertura)', price: 4800, default_included: 1 },
          { id: 2, label: 'Galeria online com download', price: 0, default_included: 1 },
          { id: 3, label: 'Trailer em vídeo (3 min)', price: 2200, default_included: 0 },
          { id: 4, label: 'Álbum impresso 30x30cm', price: 1600, default_included: 0 } ] },
        { id: 2, title: 'Completo', description: 'Foto e filme do making-of à festa.', items: [
          { id: 5, label: 'Fotografia com 2 fotógrafos (10h)', price: 7200, default_included: 1 },
          { id: 6, label: 'Filme completo em 4K', price: 5400, default_included: 1 },
          { id: 7, label: 'Trailer (5 min)', price: 0, default_included: 1 },
          { id: 8, label: 'Drone', price: 1200, default_included: 0 },
          { id: 9, label: 'Pré-wedding', price: 1800, default_included: 0 } ] },
        { id: 3, title: 'Destination', description: 'Cobertura de 3 dias em qualquer lugar do mundo.', items: [
          { id: 10, label: 'Equipe de foto e vídeo por 3 dias', price: 18500, default_included: 1 },
          { id: 11, label: 'Filme documentário', price: 0, default_included: 1 },
          { id: 12, label: 'Passagens e hospedagem da equipe', price: 0, default_included: 1 },
          { id: 13, label: 'Fotolivro de 60 páginas', price: 2900, default_included: 0 } ] }
      ],
      orders: [
        { id: 1, package_id: 2, package_title: 'Completo', total: 12600, payer_name: 'Julia Mendes', payer_email: 'julia.rafael@email.com', status: 'approved', created_at: daysAgo(12) },
        { id: 2, package_id: 1, package_title: 'Essencial', total: 6400, payer_name: 'Renata Lima', payer_email: 'renata@email.com', status: 'pending', created_at: daysAgo(1) }
      ],
      products: [
        { id: 1, title: 'Porta-retrato de madeira 20x30', description: '', price: 189 },
        { id: 2, title: 'Fotolivro capa de linho (40 páginas)', description: '', price: 890 },
        { id: 3, title: 'Caixa de pendrive gravada', description: '', price: 240 },
        { id: 4, title: 'Impressão fine art 50x70', description: '', price: 420 }
      ],
      productOrders: [
        { id: 1, product_title: 'Fotolivro capa de linho (40 páginas)', quantity: 1, total: 890, payer_name: 'Ana Carolina Souza', payer_email: 'ana.pedro@email.com', status: 'approved', created_at: daysAgo(4) }
      ],
      testimonials: [
        { id: 1, owner_user_id: 2, client_name: 'Ana & Pedro', quote: 'Assistimos ao filme umas vinte vezes. Cada detalhe que a gente tinha esquecido estava lá.', photo_seed: 51, approved: 1 },
        { id: 2, owner_user_id: 2, client_name: 'Marina & Lucas', quote: 'Equipe discreta no dia e uma entrega impecável. Recomendamos para todos os amigos.', photo_seed: 31, approved: 1 },
        { id: 3, owner_user_id: 2, client_name: 'Clara & Tomás', quote: 'As fotos da serra ficaram parecendo pintura.', photo_seed: 41, approved: 1 },
        { id: 4, owner_user_id: 3, client_name: 'Julia & Rafael', quote: 'Ainda nem casamos e já amamos o pré-wedding!', photo_seed: 61, approved: 0 }
      ],
      shares: [],
      session: null
    };
  }

  let db = readStore();
  if (!db || !db.users) { db = seedData(); writeStore(db); }
  const save = () => writeStore(db);
  const nextId = () => ++db.nextId;

  // ---------- Serializadores ----------
  function videoOut(v) {
    let status = v.status;
    if (status.startsWith('processing') && v.created_ms) {
      const pct = Math.min(100, Math.round((Date.now() - v.created_ms) / 250));
      if (pct >= 100 && v.auto_ready) { v.status = status = 'ready'; v.max_quality = v.max_quality || '4K'; v.duration_seconds = v.duration_seconds || 312; save(); }
      else status = 'processing:' + Math.min(pct, 99) + '%';
    }
    return { id: v.id, title: v.title, description: v.description, category: v.category, status, duration_seconds: v.duration_seconds,
      max_quality: v.max_quality, orientation: v.orientation, owner_user_id: v.owner_user_id,
      poster_url: v.poster_data || poster(v.seed), hls_url: '' };
  }
  function photoOut(p) {
    const url = p.data || photo(p.seed, p.vertical);
    return { id: p.id, url, thumb_url: url, section_id: p.section_id, source: p.source, uploader_name: p.uploader_name || '' };
  }
  function albumCover(a) {
    if (a.cover_data) return a.cover_data;
    const first = db.photos.find(p => p.album_id === a.id);
    return first && first.data ? first.data : scene(a.seed, 800, 534, true);
  }
  function albumSummary(a) {
    return { id: a.id, title: a.title, description: a.description, category: a.category, owner_user_id: a.owner_user_id, cover_url: albumCover(a) };
  }
  function albumFull(a, onlySectionId) {
    const secs = db.sections.filter(s => s.album_id === a.id && (!onlySectionId || s.id === onlySectionId));
    const sections = secs.map(s => {
      const photos = db.photos.filter(p => p.section_id === s.id).map(photoOut);
      return { id: s.id, title: s.title, description: s.description, cover_url: photos[0] ? photos[0].url : '', photos };
    });
    const photos = onlySectionId ? [] : db.photos.filter(p => p.album_id === a.id && !p.section_id).map(photoOut);
    return { ...albumSummary(a), sections, photos, allPhotosCount: db.photos.filter(p => p.album_id === a.id).length,
      guest_upload_enabled: !!a.guest_upload_enabled };
  }
  const emailOf = (uid) => (db.users.find(u => u.id === uid) || {}).email || '—';

  // ---------- Utilidades ----------
  function json(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }
  const err = (status, msg) => json({ error: msg }, status);
  const me = () => db.session ? db.users.find(u => u.id === db.session) || null : null;
  const canSee = (ownerId, user) => !ownerId || (user && (user.is_admin || user.id === ownerId));

  async function fileToDataUrl(file, max = 1400) {
    if (!file || !file.type || !file.type.startsWith('image/')) return null;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return { data: c.toDataURL('image/jpeg', 0.78), vertical: c.height > c.width };
    } catch { return null; }
  }
  async function storePhotos(files, albumId, sectionId, extra = {}) {
    const list = files.slice(0, 20);
    for (const f of list) {
      const out = await fileToDataUrl(f);
      if (!out) continue;
      db.photos.push({ id: nextId(), album_id: albumId, section_id: sectionId, seed: 0, vertical: out.vertical, data: out.data, source: 'studio', ...extra });
    }
    save();
    return list.length;
  }

  // ---------- Rotas ----------
  async function handle(method, path, body, form) {
    const user = me();
    const isAdmin = !!(user && user.is_admin);
    let m;

    // Auth
    if (path === '/api/auth/me') return user ? json({ id: user.id, email: user.email, isAdmin }) : err(401, 'Não autenticado');
    if (path === '/api/auth/login' && method === 'POST') {
      const u = db.users.find(x => x.email.toLowerCase() === String(body.email || '').trim().toLowerCase());
      if (!u || u.password !== body.password) return err(401, 'Email ou senha incorretos');
      db.session = u.id; save();
      return json({ isAdmin: !!u.is_admin });
    }
    if (path === '/api/auth/logout') { db.session = null; save(); return json({ ok: true }); }
    if (path === '/api/auth/users') {
      if (!isAdmin) return err(403, 'Apenas admin');
      if (method === 'POST') {
        if (!body.email || !body.password) return err(400, 'Email e senha obrigatórios');
        if (db.users.some(u => u.email === body.email)) return err(400, 'Esse email já existe');
        const u = { id: nextId(), email: body.email, password: body.password, is_admin: 0, created_at: new Date().toISOString() };
        db.users.push(u); save(); return json({ id: u.id });
      }
      return json(db.users.map(u => ({ id: u.id, email: u.email, is_admin: u.is_admin, created_at: u.created_at })));
    }
    if ((m = path.match(/^\/api\/auth\/users\/(\d+)$/)) && method === 'DELETE') {
      if (!isAdmin) return err(403, 'Apenas admin');
      db.users = db.users.filter(u => u.id !== +m[1]); save(); return json({ ok: true });
    }

    // Vídeos
    if (path === '/api/videos/portfolio') return json(db.videos.filter(v => !v.owner_user_id).map(videoOut));
    if (path === '/api/videos') {
      if (!user) return err(401, 'Não autenticado');
      if (method === 'POST') {
        if (!isAdmin) return err(403, 'Apenas admin');
        const posterFile = form && form.get('poster');
        const posterData = posterFile && posterFile.size ? (await fileToDataUrl(posterFile, 960) || {}).data : null;
        const owner = form.get('ownerUserId');
        db.videos.push({ id: nextId(), title: form.get('title') || 'Novo filme', description: form.get('description') || '', category: form.get('category') || 'Casamentos',
          status: 'processing', duration_seconds: 0, max_quality: '', orientation: 'horizontal', owner_user_id: owner ? +owner : null,
          seed: Math.floor(Math.random() * 500), poster_data: posterData, created_ms: Date.now(), auto_ready: true });
        save(); return json({ ok: true });
      }
      const list = isAdmin ? db.videos : db.videos.filter(v => v.owner_user_id === user.id);
      return json(list.map(videoOut));
    }
    if ((m = path.match(/^\/api\/videos\/(\d+)$/))) {
      const v = db.videos.find(x => x.id === +m[1]);
      if (method === 'DELETE') { if (!isAdmin) return err(403, 'Apenas admin'); db.videos = db.videos.filter(x => x !== v); save(); return json({ ok: true }); }
      if (!v) return err(404, 'Não encontrado');
      if (!canSee(v.owner_user_id, user)) return err(403, 'Privado');
      return json(videoOut(v));
    }

    // Álbuns: compartilhamento e convidados (sem login)
    if ((m = path.match(/^\/api\/albums\/share\/([\w-]+)$/))) {
      const s = db.shares.find(x => x.token === m[1]);
      if (!s) return err(404, 'Link inválido');
      const a = db.albums.find(x => x.id === s.album_id);
      if (!a) return err(404, 'Link inválido');
      const full = albumFull(a, s.section_id);
      if (s.section_id && full.sections[0]) full.title = `${a.title} · ${full.sections[0].title}`;
      return json({ ...full, allowDownload: s.allow_download });
    }
    if ((m = path.match(/^\/api\/albums\/guest-upload\/([\w-]+)(\/photos)?$/))) {
      const a = db.albums.find(x => x.guest_upload_enabled && x.guest_upload_token === m[1]);
      if (!a) return err(404, 'Link inativo');
      if (!m[2]) return json({ title: a.title });
      let sec = db.sections.find(s => s.album_id === a.id && s.title === 'Fotos dos convidados');
      if (!sec) { sec = { id: nextId(), album_id: a.id, title: 'Fotos dos convidados', description: 'Enviadas pelos convidados durante a festa' }; db.sections.push(sec); }
      const n = await storePhotos(form.getAll('photos'), a.id, sec.id, { source: 'guest', uploader_name: form.get('uploaderName') || 'Convidado' });
      return json({ uploading: n });
    }

    if (path === '/api/albums/portfolio') return json(db.albums.filter(a => !a.owner_user_id).map(albumSummary));
    if (path === '/api/albums') {
      if (!user) return err(401, 'Não autenticado');
      if (method === 'POST') {
        if (!isAdmin) return err(403, 'Apenas admin');
        if (!body.title) return err(400, 'Título obrigatório');
        const a = { id: nextId(), title: body.title, description: body.description || '', category: body.category || 'Casamentos',
          owner_user_id: body.ownerUserId ? +body.ownerUserId : null, seed: Math.floor(Math.random() * 500) };
        db.albums.push(a); save(); return json({ id: a.id });
      }
      const list = isAdmin ? db.albums : db.albums.filter(a => a.owner_user_id === user.id);
      return json(list.map(albumSummary));
    }
    if ((m = path.match(/^\/api\/albums\/(\d+)(\/.*)?$/))) {
      const a = db.albums.find(x => x.id === +m[1]);
      const sub = m[2] || '';
      if (!a) return err(404, 'Álbum não encontrado');
      if (!canSee(a.owner_user_id, user)) return err(403, 'Privado');
      const owns = user && (isAdmin || a.owner_user_id === user.id);

      if (!sub) {
        if (method === 'DELETE') {
          if (!isAdmin) return err(403, 'Apenas admin');
          db.albums = db.albums.filter(x => x !== a); db.photos = db.photos.filter(p => p.album_id !== a.id); save();
          return json({ ok: true });
        }
        return json(albumFull(a));
      }
      if (sub === '/sections' && method === 'POST') {
        if (!isAdmin) return err(403, 'Apenas admin');
        const s = { id: nextId(), album_id: a.id, title: body.title, description: '' };
        db.sections.push(s); save(); return json({ id: s.id });
      }
      if (sub === '/photos' && method === 'POST') {
        if (!isAdmin) return err(403, 'Apenas admin');
        const sectionId = form.get('sectionId');
        const n = await storePhotos(form.getAll('photos'), a.id, sectionId ? +sectionId : null);
        return json({ uploading: n });
      }
      if (sub === '/comments') {
        if (!owns) return err(403, 'Só o dono do álbum pode comentar');
        if (method === 'POST') {
          if (!body.body) return err(400, 'Comentário vazio');
          db.comments.push({ id: nextId(), album_id: a.id, user_id: user.id, body: body.body, created_at: new Date().toISOString() });
          save(); return json({ ok: true });
        }
        return json(db.comments.filter(c => c.album_id === a.id).map(c => ({ ...c, author: emailOf(c.user_id) })));
      }
      if (!owns) return err(403, 'Sem permissão');
      if (sub === '/share' || (m = sub.match(/^\/sections\/(\d+)\/share$/))) {
        const sectionId = sub === '/share' ? null : +m[1];
        const token = Math.random().toString(36).slice(2, 12);
        db.shares.push({ token, album_id: a.id, section_id: sectionId, allow_download: !!body.allowDownload }); save();
        return json({ token });
      }
      if (sub === '/guest-upload/toggle') {
        a.guest_upload_enabled = body.enabled ? 1 : 0;
        if (body.enabled && !a.guest_upload_token) a.guest_upload_token = Math.random().toString(36).slice(2, 12);
        save(); return json({ token: body.enabled ? a.guest_upload_token : null });
      }
    }

    // Contratos
    if (path === '/api/contracts') {
      if (!isAdmin) return err(403, 'Apenas admin');
      if (method === 'POST') {
        const c = { id: nextId(), owner_user_id: +body.ownerUserId, title: body.title, body: body.body || '', status: 'pending',
          signer_name: '', signature_data_url: '', signed_at: null, events: body.events || [] };
        db.contracts.push(c); save(); return json({ id: c.id });
      }
      return json(db.contracts.map(c => ({ ...c, owner_email: emailOf(c.owner_user_id) })));
    }
    if (path === '/api/contracts/mine') {
      if (!user) return err(401, 'Não autenticado');
      return json(db.contracts.filter(c => c.owner_user_id === user.id));
    }
    if ((m = path.match(/^\/api\/contracts\/(\d+)(\/sign)?$/))) {
      const c = db.contracts.find(x => x.id === +m[1]);
      if (!c) return err(404, 'Contrato não encontrado');
      if (!user || !(isAdmin || c.owner_user_id === user.id)) return err(403, 'Sem permissão');
      if (method === 'DELETE') { db.contracts = db.contracts.filter(x => x !== c); save(); return json({ ok: true }); }
      if (m[2]) {
        if (c.status === 'signed') return err(400, 'Contrato já assinado');
        Object.assign(c, { status: 'signed', signer_name: body.signerName, signature_data_url: body.signatureDataUrl, signed_at: new Date().toISOString() });
        save(); return json({ ok: true });
      }
      return json(c);
    }

    // Pacotes
    const pkgOut = (p) => ({ ...p, basePrice: p.items.filter(i => i.default_included).reduce((s, i) => s + i.price, 0) });
    if (path === '/api/packages') {
      if (method === 'POST') {
        if (!isAdmin) return err(403, 'Apenas admin');
        const p = { id: nextId(), title: body.title, description: body.description || '',
          items: (body.items || []).map(i => ({ id: nextId(), label: i.label, price: i.price, default_included: i.defaultIncluded ? 1 : 0 })) };
        db.packages.push(p); save(); return json({ id: p.id });
      }
      return json(db.packages.map(pkgOut));
    }
    if (path === '/api/packages/orders/all') return isAdmin ? json(db.orders) : err(403, 'Apenas admin');
    if ((m = path.match(/^\/api\/packages\/(\d+)(\/checkout)?$/))) {
      const p = db.packages.find(x => x.id === +m[1]);
      if (method === 'DELETE') { if (!isAdmin) return err(403, 'Apenas admin'); db.packages = db.packages.filter(x => x !== p); save(); return json({ ok: true }); }
      if (m[2] && p) {
        const items = body.selectedItemIds ? p.items.filter(i => body.selectedItemIds.includes(i.id)) : p.items.filter(i => i.default_included);
        db.orders.unshift({ id: nextId(), package_id: p.id, package_title: p.title, total: items.reduce((s, i) => s + i.price, 0),
          payer_name: body.payerName, payer_email: body.payerEmail, status: 'approved', created_at: new Date().toISOString() });
        save(); return json({ checkoutUrl: 'checkout-sucesso.html' });
      }
    }

    // Produtos
    if (path === '/api/products') {
      if (method === 'POST') {
        if (!isAdmin) return err(403, 'Apenas admin');
        db.products.push({ id: nextId(), title: body.title, description: body.description || '', price: parseFloat(String(body.price).replace(',', '.')) || 0 });
        save(); return json({ ok: true });
      }
      return json(db.products);
    }
    if (path === '/api/products/orders/all') return isAdmin ? json(db.productOrders) : err(403, 'Apenas admin');
    if ((m = path.match(/^\/api\/products\/(\d+)(\/order)?$/))) {
      const p = db.products.find(x => x.id === +m[1]);
      if (method === 'DELETE') { if (!isAdmin) return err(403, 'Apenas admin'); db.products = db.products.filter(x => x !== p); save(); return json({ ok: true }); }
      if (m[2] && p) {
        const qty = Math.max(1, parseInt(body.quantity, 10) || 1);
        db.productOrders.unshift({ id: nextId(), product_title: p.title, quantity: qty, total: p.price * qty,
          payer_name: body.payerName, payer_email: body.payerEmail, status: 'approved', created_at: new Date().toISOString() });
        save(); return json({ checkoutUrl: 'checkout-sucesso.html' });
      }
    }

    // Depoimentos
    const tOut = (t) => ({ ...t, photo_url: t.photo_url || (t.photo_seed ? scene(t.photo_seed, 800, 534, true) : ''), owner_email: emailOf(t.owner_user_id) });
    if (path === '/api/testimonials/portfolio') return json(db.testimonials.filter(t => t.approved).map(tOut));
    if (path === '/api/testimonials') {
      if (method === 'POST') {
        if (!user) return err(401, 'Não autenticado');
        db.testimonials.push({ id: nextId(), owner_user_id: user.id, client_name: body.clientName, quote: body.quote, photo_url: body.photoUrl || '', approved: 0 });
        save(); return json({ ok: true });
      }
      return isAdmin ? json(db.testimonials.map(tOut)) : err(403, 'Apenas admin');
    }
    if ((m = path.match(/^\/api\/testimonials\/(\d+)(\/approve)?$/))) {
      if (!isAdmin) return err(403, 'Apenas admin');
      const t = db.testimonials.find(x => x.id === +m[1]);
      if (m[2]) { if (t) t.approved = 1; } else db.testimonials = db.testimonials.filter(x => x !== t);
      save(); return json({ ok: true });
    }

    return err(404, 'Rota não encontrada na demonstração');
  }

  // ---------- Interceptação do fetch ----------
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const u = new URL(url, location.href);
    const path = url.startsWith('/api/') ? url.split('?')[0] : (u.pathname.includes('/api/') ? u.pathname.slice(u.pathname.indexOf('/api/')) : null);
    if (!path) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    let body = {}, form = null;
    if (init.body instanceof FormData) form = init.body;
    else if (typeof init.body === 'string') { try { body = JSON.parse(init.body); } catch {} }
    await new Promise(r => setTimeout(r, 60));
    try { return await handle(method, path, body, form); }
    catch (e) { console.error(e); return err(500, 'Erro na demonstração: ' + e.message); }
  };

  // ---------- Roteador: todas as páginas rodam dentro de um único documento ----------
  // window.__PAGES é gerado no build: { 'album.html': { title, body, run } }
  const ROUTE_KEY = 'wfdemo_route';
  let route = { page: 'demo', search: '' };
  let cleanups = [];
  window.__demoSearch = () => route.search;
  window.__demoBase = () => '';

  function trackGlobals() {
    const docAdd = document.addEventListener.bind(document);
    const winAdd = window.addEventListener.bind(window);
    const origSetInterval = window.setInterval.bind(window);
    const ready = [];
    document.addEventListener = (type, fn, opt) => {
      if (type === 'DOMContentLoaded') { ready.push(fn); return; }
      docAdd(type, fn, opt); cleanups.push(() => document.removeEventListener(type, fn, opt));
    };
    window.addEventListener = (type, fn, opt) => {
      winAdd(type, fn, opt); cleanups.push(() => window.removeEventListener(type, fn, opt));
    };
    window.setInterval = (fn, ms) => { const id = origSetInterval(fn, ms); cleanups.push(() => clearInterval(id)); return id; };
    return { ready, restore() {
      delete document.addEventListener;
      delete window.addEventListener;
      window.setInterval = origSetInterval;
    } };
  }

  window.__demoGo = function (href) {
    const mq = String(href || '').match(/^(?:\.\/)?([\w-]+\.html|demo)(\?[^#]*)?/);
    const page = mq && window.__PAGES[mq[1]] ? mq[1] : 'portfolio.html';
    route = { page, search: (mq && mq[2]) || '' };
    try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify(route)); } catch {}
    cleanups.forEach(fn => { try { fn(); } catch {} });
    cleanups = [];
    const def = window.__PAGES[page];
    document.title = def.title;
    document.getElementById('app').innerHTML = def.body.replace(/img\/logo-duna\.png/g, window.__LOGO || 'img/logo-duna.png');
    window.scrollTo(0, 0);
    const tracker = trackGlobals();
    try { def.run(); } catch (e) { console.error(e); }
    tracker.ready.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
    tracker.restore();
    afterRender();
  };

  function toast(msg) {
    let t = document.getElementById('demoToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'demoToast';
      t.setAttribute('role', 'status');
      t.style.cssText = 'position:fixed;left:50%;bottom:calc(64px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:9999;max-width:min(520px,calc(100% - 32px));background:#eef3f9;color:#0d1420;padding:12px 16px;border-radius:8px;font:500 14px/1.45 Inter,system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.4);white-space:pre-line;transition:opacity .2s;opacity:0;pointer-events:none;';
      document.body.appendChild(t);
    }
    t.textContent = msg; t.style.opacity = '1';
    clearTimeout(t._h); t._h = setTimeout(() => { t.style.opacity = '0'; }, 4200);
  }
  window.__demoDownload = () => toast('Na versão real, o download começa aqui. A demonstração não baixa arquivos.');
  // A janela da demonstração não exibe alert/confirm nativos
  window.alert = (msg) => toast(String(msg));
  window.confirm = () => true;

  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href.includes('/api/') || a.hasAttribute('download')) { e.preventDefault(); e.stopPropagation(); window.__demoDownload(); return; }
    if (href === '#') { e.preventDefault(); return; }
    if (/^(?:\.\/)?[\w-]+\.html/.test(href)) { e.preventDefault(); window.__demoGo(href); }
  }, true);

  // ---------- Barra da demonstração ----------
  const ROLES = { visitante: null, cliente: 2, admin: 1 };
  window.__demoAs = function (role) {
    db.session = ROLES[role]; save();
    window.__demoGo(role === 'admin' ? 'admin.html' : role === 'cliente' ? 'minha-area.html' : 'portfolio.html');
  };
  window.__demoReset = function () { db = seedData(); save(); toast('Dados de exemplo restaurados.'); window.__demoGo('portfolio.html'); };

  function afterRender() {
    const current = me();
    const role = !current ? 'visitante' : current.is_admin ? 'admin' : 'cliente';
    let bar = document.getElementById('demoBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'demoBar'; document.body.appendChild(bar); }
    bar.hidden = route.page === 'demo';
    bar.innerHTML = `
      <span><b>Demonstração</b> com dados de exemplo · ver como</span>
      <span class="seg" role="group" aria-label="Ver o site como">
        ${['visitante', 'cliente', 'admin'].map(r => `<button type="button" aria-pressed="${r === role}" onclick="__demoAs('${r}')">${r[0].toUpperCase() + r.slice(1)}</button>`).join('')}
      </span>
      <button type="button" class="reset" onclick="__demoGo('demo')">Início</button>
      <button type="button" class="reset" onclick="__demoReset()">Restaurar dados</button>`;

    // O player da demonstração não tem o arquivo de vídeo real
    const player = document.getElementById('player');
    if (player) {
      const id = new URLSearchParams(route.search).get('id');
      const v = db.videos.find(x => x.id === +id);
      if (v) player.poster = v.poster_data || poster(v.seed);
      const info = document.querySelector('.watch-info');
      if (info) info.insertAdjacentHTML('beforeend', '<p style="color:var(--ink-dim);font-size:13px;margin-top:12px;">Na demonstração não há arquivo de vídeo. No site real, o filme toca aqui em streaming adaptativo (HLS, de 1080p a 4K).</p>');
    }

    const login = document.getElementById('loginForm');
    if (login) login.insertAdjacentHTML('afterend', `<p style="margin-top:18px;font-size:12.5px;line-height:1.6;color:var(--ink-dim);">
      Contas de teste (senha <b style="color:var(--ink)">demo123</b>):<br>admin@duna.demo<br>ana.pedro@email.com<br>julia.rafael@email.com</p>`);
  }

  window.__demoStart = function () {
    let start = 'demo';
    try { const r = JSON.parse(sessionStorage.getItem(ROUTE_KEY) || 'null'); if (r && window.__PAGES[r.page]) start = r.page + r.search; } catch {}
    window.__demoGo(start);
  };
})();
