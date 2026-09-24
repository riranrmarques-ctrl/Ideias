// DunaStudio — Worker do Cloudflare
// Publica dunabranding.com.br/studio: as páginas do site e a API (/studio/api/...).
// As páginas vêm embutidas neste arquivo (gerado por build.js a partir da pasta site/).
// Se o Worker tiver o bucket HOSP ligado e a página não estiver embutida, ela é lida de hosp/studio/.
// Login e banco ficam no Supabase; filmes e fotos ficam no bucket "dunastudio" (privado).
//
// Ligações (bindings) e variáveis esperadas — ver wrangler.toml e README:
//   HOSP (R2, opcional)    bucket com páginas extras na pasta studio/
//   MEDIA (R2)             bucket privado dos filmes e fotos
//   SUPABASE_URL           ex: https://xxxx.supabase.co
//   SUPABASE_ANON_KEY      chave pública (anon) do Supabase
//   SUPABASE_SERVICE_KEY   (segredo) service role key do Supabase
//   MEDIA_SIGNING_SECRET   (segredo) texto longo e aleatório para assinar os links de mídia
//   ADMIN_EMAILS           e-mails de administradores, separados por vírgula
//   SITE_URL               ex: https://dunabranding.com.br/studio
//   MP_ACCESS_TOKEN        (segredo, opcional) Mercado Pago
//   RESEND_API_KEY         (segredo, opcional) envio de e-mail de venda pelo Resend
//   NOTIFY_EMAIL, MAIL_FROM (opcionais) destino e remetente do e-mail de venda

const BASE = '/studio';
// Preenchido pelo build.js: { "portfolio.html": { type, body, base64 } }
const SITE_FILES = /*__SITE_FILES__*/ {};
const SITE_PREFIX = 'studio/';
const MEDIA_TTL_SECONDS = 12 * 60 * 60;
const GUEST_MAX_BYTES = 30 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === BASE) return Response.redirect(`${url.origin}${BASE}/${url.search}`, 301);
    if (!path.startsWith(BASE + '/')) return new Response('Não encontrado', { status: 404 });

    const sub = path.slice(BASE.length);
    if (sub.startsWith('/api/')) {
      try {
        return await handleApi(request, env, ctx, url, sub.slice(4));
      } catch (err) {
        if (err instanceof HttpError) return json({ error: err.message }, err.status);
        console.error('[dunastudio]', err && err.stack || err);
        return json({ error: 'Erro interno. Tente de novo em instantes.' }, 500);
      }
    }
    return serveSite(request, env, sub);
  }
};

// ---------------------------------------------------------------------------
// Páginas do site (bucket HOSP, pasta studio/)
// ---------------------------------------------------------------------------
const MIME = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', ico: 'image/x-icon', txt: 'text/plain; charset=utf-8',
  woff2: 'font/woff2', mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', heic: 'image/heic'
};
const extOf = (name) => (name.split('?')[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';

async function readSiteFile(env, file) {
  const embedded = SITE_FILES[file];
  if (embedded) {
    const body = embedded.base64 ? Uint8Array.from(atob(embedded.body), ch => ch.charCodeAt(0)) : embedded.body;
    return { body, etag: embedded.etag };
  }
  if (!env.HOSP) return null;
  const obj = await env.HOSP.get(SITE_PREFIX + file);
  return obj ? { body: obj.body, etag: obj.httpEtag } : null;
}

async function serveSite(request, env, sub) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Método não permitido', { status: 405 });
  let file = decodeURIComponent(sub.slice(1)) || 'portfolio.html';
  if (file.includes('..')) return new Response('Não encontrado', { status: 404 });
  if (file.endsWith('/')) file += 'index.html';

  let found = await readSiteFile(env, file);
  if (!found && !extOf(file)) { file += '.html'; found = await readSiteFile(env, file); }
  if (!found && (!extOf(file) || extOf(file) === 'html')) { file = 'portfolio.html'; found = await readSiteFile(env, file); }
  if (!found) return new Response('Não encontrado', { status: 404 });

  const ext = extOf(file);
  const headers = new Headers({
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === 'html' ? 'no-cache' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin'
  });
  if (found.etag) headers.set('ETag', found.etag);
  if (found.etag && request.headers.get('If-None-Match') === found.etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : found.body, { headers });
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }
  });
}
const ok = (data = {}) => json({ ok: true, ...data });

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

const enc = encodeURIComponent;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const safeName = (name, fallback) => (String(name || '').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').slice(-80) || fallback);
const randomId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

// ---------------------------------------------------------------------------
// Supabase (PostgREST com a service role key — o RLS bloqueia qualquer outro acesso)
// ---------------------------------------------------------------------------
async function sb(env, pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const headers = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${pathAndQuery.split('?')[0]}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function db(env) {
  return {
    list: (table, query = '') => sb(env, `${table}?${query}`),
    one: async (table, query) => (await sb(env, `${table}?${query}&limit=1`))[0] || null,
    insert: async (table, row) => (await sb(env, table, { method: 'POST', body: row, prefer: 'return=representation' }))[0],
    insertMany: (table, rows) => rows.length ? sb(env, table, { method: 'POST', body: rows, prefer: 'return=minimal' }) : null,
    update: (table, filter, patch) => sb(env, `${table}?${filter}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' }),
    remove: (table, filter) => sb(env, `${table}?${filter}`, { method: 'DELETE', prefer: 'return=minimal' }),
    rpc: (fn, args) => sb(env, `rpc/${fn}`, { method: 'POST', body: args })
  };
}

async function nextPosition(D, table, filter) {
  const last = await D.one(table, `select=position&${filter ? filter + '&' : ''}order=position.desc`);
  return last ? last.position + 1 : 0;
}

// ---------------------------------------------------------------------------
// Sessão (token do Supabase Auth enviado pelo navegador em Authorization: Bearer)
// ---------------------------------------------------------------------------
function adminEmails(env) {
  return String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
}

async function loadUser(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const authUser = await res.json();
  if (!authUser?.id) return null;

  const D = db(env);
  const email = String(authUser.email || '').toLowerCase();
  let profile = await D.one('studio_profiles', `select=role&user_id=eq.${authUser.id}`);
  const listedAdmin = adminEmails(env).includes(email);
  if (listedAdmin && profile?.role !== 'admin') {
    await sb(env, 'studio_profiles?on_conflict=user_id', {
      method: 'POST', body: { user_id: authUser.id, email, role: 'admin' },
      prefer: 'resolution=merge-duplicates,return=minimal'
    });
    profile = { role: 'admin' };
  }
  return { id: authUser.id, email, isAdmin: profile?.role === 'admin', hasAccess: !!profile };
}

// ---------------------------------------------------------------------------
// Links assinados de mídia (o bucket é privado; o Worker entrega com um token por pasta)
// ---------------------------------------------------------------------------
let signingKeyPromise = null;
function signingKey(env) {
  if (!env.MEDIA_SIGNING_SECRET) throw new Error('MEDIA_SIGNING_SECRET não configurado');
  signingKeyPromise ||= crypto.subtle.importKey('raw', new TextEncoder().encode(env.MEDIA_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return signingKeyPromise;
}
function b64url(buffer) {
  let s = ''; for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(env, message) {
  return b64url(await crypto.subtle.sign('HMAC', await signingKey(env), new TextEncoder().encode(message)));
}
async function mediaToken(env, prefix) {
  const exp = Math.floor(Date.now() / 1000) + MEDIA_TTL_SECONDS;
  return `p=${enc(prefix)}&e=${exp}&s=${await hmac(env, `${prefix}|${exp}`)}`;
}
function mediaUrl(key, token, downloadName) {
  if (!key) return '';
  const path = key.split('/').map(enc).join('/');
  return `api/media/${path}?${token}${downloadName ? `&dl=1&n=${enc(downloadName)}` : ''}`;
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function serveMedia(request, env, url, key) {
  const prefix = url.searchParams.get('p') || '';
  const exp = Number(url.searchParams.get('e') || 0);
  const sig = url.searchParams.get('s') || '';
  if (!prefix || !key.startsWith(prefix) || key.includes('..')) throw new HttpError(403, 'Link inválido');
  if (!exp || exp < Date.now() / 1000) throw new HttpError(403, 'Link expirado. Recarregue a página.');
  if (!timingSafeEqual(sig, await hmac(env, `${prefix}|${exp}`))) throw new HttpError(403, 'Link inválido');

  const range = parseRange(request.headers.get('Range'));
  const obj = request.method === 'HEAD'
    ? await env.MEDIA.head(key)
    : await env.MEDIA.get(key, range ? { range } : undefined);
  if (!obj) throw new HttpError(404, 'Arquivo não encontrado');

  const headers = new Headers({
    'Content-Type': obj.httpMetadata?.contentType || MIME[extOf(key)] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
    ETag: obj.httpEtag
  });
  if (url.searchParams.get('dl') === '1') {
    const name = (url.searchParams.get('n') || key.split('/').pop()).replace(/["\\\r\n]/g, '');
    headers.set('Content-Disposition', `attachment; filename="${safeName(name, 'arquivo')}"; filename*=UTF-8''${enc(name)}`);
  }
  if (request.method === 'HEAD') {
    headers.set('Content-Length', String(obj.size));
    return new Response(null, { headers });
  }
  if (range && obj.range) {
    const offset = obj.range.offset ?? (obj.size - obj.range.suffix);
    const length = obj.range.length ?? (obj.size - offset);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers });
}

function parseRange(header) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') return { suffix: Number(m[2]) };
  const offset = Number(m[1]);
  return m[2] === '' ? { offset } : { offset, length: Number(m[2]) - offset + 1 };
}

async function deleteMediaPrefix(env, prefix) {
  let cursor;
  do {
    const page = await env.MEDIA.list({ prefix, cursor });
    if (page.objects.length) await env.MEDIA.delete(page.objects.map(o => o.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// Grava o corpo da requisição direto no R2 (sem carregar o arquivo na memória do Worker)
async function putBody(env, request, key, maxBytes) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (!length || !request.body) throw new HttpError(400, 'Arquivo vazio');
  if (maxBytes && length > maxBytes) throw new HttpError(413, `Arquivo grande demais (máximo ${Math.round(maxBytes / 1048576)} MB)`);
  const contentType = request.headers.get('Content-Type') || MIME[extOf(key)] || 'application/octet-stream';
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType } });
  return length;
}

// ---------------------------------------------------------------------------
// Roteador da API
// ---------------------------------------------------------------------------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });

async function handleApi(request, env, ctx, url, apiPath) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY || !env.SUPABASE_ANON_KEY) {
    throw new HttpError(500, 'Supabase não configurado no Worker');
  }
  const method = request.method === 'HEAD' ? 'GET' : request.method;

  let userPromise = null;
  const c = {
    request, env, ctx, url, D: db(env),
    user: () => (userPromise ||= loadUser(request, env)),
    async auth() {
      const u = await c.user();
      if (!u) throw new HttpError(401, 'Faça login para continuar');
      if (!u.hasAccess) throw new HttpError(403, 'Sua conta não tem acesso ao Studio. Fale com a Duna.');
      return u;
    },
    async admin() {
      const u = await c.auth();
      if (!u.isAdmin) throw new HttpError(403, 'Apenas administradores');
      return u;
    },
    body: () => readJson(request)
  };

  const mediaMatch = apiPath.match(/^\/media\/(.+)$/);
  if (mediaMatch && method === 'GET') {
    return serveMedia(request, env, url, mediaMatch[1].split('/').map(decodeURIComponent).join('/'));
  }

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = apiPath.match(r.pattern);
    if (m) return r.handler(c, ...m.slice(1));
  }
  throw new HttpError(404, 'Rota não encontrada');
}

// ---------------------------------------------------------------------------
// Configuração pública e contas
// ---------------------------------------------------------------------------
route('GET', '/config', (c) => json({ supabaseUrl: c.env.SUPABASE_URL, supabaseAnonKey: c.env.SUPABASE_ANON_KEY }, 200, { 'Cache-Control': 'public, max-age=300' }));

route('GET', '/auth/me', async (c) => {
  const u = await c.auth();
  return json({ id: u.id, email: u.email, isAdmin: u.isAdmin });
});

route('GET', '/auth/users', async (c) => {
  await c.admin();
  const rows = await c.D.list('studio_profiles', 'select=user_id,email,role,created_at&order=created_at.desc');
  return json(rows.map(p => ({ id: p.user_id, email: p.email, is_admin: p.role === 'admin', created_at: p.created_at })));
});

route('POST', '/auth/users', async (c) => {
  await c.admin();
  const { email, password } = await c.body();
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !password) throw new HttpError(400, 'E-mail e senha são obrigatórios');
  if (String(password).length < 6) throw new HttpError(400, 'A senha precisa ter pelo menos 6 caracteres');

  const res = await fetch(`${c.env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: c.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${c.env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cleanEmail, password, email_confirm: true })
  });
  const data = await res.json().catch(() => ({}));
  let userId = data?.id;
  let existed = false;
  if (!res.ok) {
    // A conta pode já existir no Supabase (ex: usada em outro sistema da Duna): só libera o acesso ao Studio
    const found = await c.D.rpc('studio_find_user_id', { p_email: cleanEmail }).catch(() => null);
    if (!found) throw new HttpError(400, data?.msg || data?.error_description || 'Não foi possível criar a conta');
    userId = found;
    existed = true;
  }
  const already = await c.D.one('studio_profiles', `select=user_id&user_id=eq.${userId}`);
  if (already) throw new HttpError(400, 'Esse e-mail já tem acesso ao Studio');
  await c.D.insert('studio_profiles', { user_id: userId, email: cleanEmail, role: 'client' });
  return ok({ id: userId, existed });
});

route('DELETE', '/auth/users/([0-9a-f-]{36})', async (c, id) => {
  const me = await c.admin();
  if (id === me.id) throw new HttpError(400, 'Você não pode remover o próprio acesso');
  // Remove só o acesso ao Studio; a conta do Supabase continua existindo
  await c.D.remove('studio_profiles', `user_id=eq.${id}`);
  return ok();
});

// ---------------------------------------------------------------------------
// Filmes
// ---------------------------------------------------------------------------
const VIDEO_COLUMNS = 'id,storage_key,title,description,category,poster_key,video_key,status,duration_seconds,max_quality,orientation,owner_user_id,created_at';

async function videoOut(env, v) {
  const token = await mediaToken(env, `videos/${v.storage_key}/`);
  const { poster_key, video_key, storage_key, ...rest } = v;
  return {
    ...rest,
    poster_url: mediaUrl(poster_key, token),
    video_url: v.status === 'ready' ? mediaUrl(video_key, token) : ''
  };
}

async function canSee(c, ownerId) {
  if (!ownerId) return true;
  const u = await c.user();
  return !!(u && u.hasAccess && (u.isAdmin || u.id === ownerId));
}

route('GET', '/videos/portfolio', async (c) => {
  const rows = await c.D.list('studio_videos', `select=${VIDEO_COLUMNS}&owner_user_id=is.null&status=eq.ready&order=created_at.desc`);
  return json(await Promise.all(rows.map(v => videoOut(c.env, v))));
});

route('GET', '/videos', async (c) => {
  const u = await c.auth();
  const filter = u.isAdmin ? '' : `&owner_user_id=eq.${u.id}&status=eq.ready`;
  const rows = await c.D.list('studio_videos', `select=${VIDEO_COLUMNS}${filter}&order=created_at.desc`);
  return json(await Promise.all(rows.map(v => videoOut(c.env, v))));
});

route('GET', '/videos/(\\d+)', async (c, id) => {
  const v = await c.D.one('studio_videos', `select=${VIDEO_COLUMNS}&id=eq.${id}`);
  if (!v) throw new HttpError(404, 'Vídeo não encontrado');
  if (!(await canSee(c, v.owner_user_id))) throw new HttpError(403, 'Faça login pra ver este vídeo');
  return json(await videoOut(c.env, v));
});

route('POST', '/videos', async (c) => {
  await c.admin();
  const { title, description, category, ownerUserId, filename } = await c.body();
  if (!title) throw new HttpError(400, 'Título é obrigatório');
  const storageKey = crypto.randomUUID();
  const ext = extOf(filename || '') || 'mp4';
  const v = await c.D.insert('studio_videos', {
    storage_key: storageKey, title, description: description || '', category: category || 'Casamentos',
    owner_user_id: isUuid(ownerUserId) ? ownerUserId : null,
    video_key: `videos/${storageKey}/filme.${ext}`, status: 'uploading'
  });
  return ok({ id: v.id });
});

route('PATCH', '/videos/(\\d+)', async (c, id) => {
  await c.admin();
  const { title, description, category, ownerUserId } = await c.body();
  const patch = { owner_user_id: isUuid(ownerUserId) ? ownerUserId : null };
  if (title) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (category) patch.category = category;
  await c.D.update('studio_videos', `id=eq.${id}`, patch);
  return ok();
});

async function adminVideo(c, id) {
  await c.admin();
  const v = await c.D.one('studio_videos', `select=*&id=eq.${id}`);
  if (!v) throw new HttpError(404, 'Vídeo não encontrado');
  return v;
}

route('PUT', '/videos/(\\d+)/poster', async (c, id) => {
  const v = await adminVideo(c, id);
  const ct = c.request.headers.get('Content-Type') || 'image/jpeg';
  const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
  const key = `videos/${v.storage_key}/capa-${randomId()}.${ext}`;
  await putBody(c.env, c.request, key, 20 * 1024 * 1024);
  if (v.poster_key) await c.env.MEDIA.delete(v.poster_key);
  await c.D.update('studio_videos', `id=eq.${id}`, { poster_key: key });
  return ok();
});

route('POST', '/videos/(\\d+)/upload/start', async (c, id) => {
  const v = await adminVideo(c, id);
  const { contentType } = await c.body();
  const upload = await c.env.MEDIA.createMultipartUpload(v.video_key, { httpMetadata: { contentType: contentType || MIME[extOf(v.video_key)] || 'video/mp4' } });
  await c.D.update('studio_videos', `id=eq.${id}`, { status: 'uploading' });
  return ok({ uploadId: upload.uploadId });
});

route('PUT', '/videos/(\\d+)/upload/part', async (c, id) => {
  const v = await adminVideo(c, id);
  const uploadId = c.url.searchParams.get('uploadId');
  const partNumber = Number(c.url.searchParams.get('part'));
  if (!uploadId || !(partNumber >= 1)) throw new HttpError(400, 'Parte inválida');
  if (!c.request.body) throw new HttpError(400, 'Parte vazia');
  const upload = c.env.MEDIA.resumeMultipartUpload(v.video_key, uploadId);
  const part = await upload.uploadPart(partNumber, c.request.body);
  return ok({ partNumber: part.partNumber, etag: part.etag });
});

route('POST', '/videos/(\\d+)/upload/complete', async (c, id) => {
  const v = await adminVideo(c, id);
  const { uploadId, parts, duration, width, height } = await c.body();
  if (!uploadId || !Array.isArray(parts) || !parts.length) throw new HttpError(400, 'Envio incompleto');
  const upload = c.env.MEDIA.resumeMultipartUpload(v.video_key, uploadId);
  const obj = await upload.complete(parts.map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));

  const w = num(width) || 0, h = num(height) || 0;
  const vertical = h > w;
  const shortSide = Math.min(w, h) || 0;
  const quality = shortSide >= 2000 ? '4K' : shortSide >= 1400 ? '1440p' : shortSide >= 1000 ? '1080p' : shortSide >= 700 ? '720p' : '';
  await c.D.update('studio_videos', `id=eq.${id}`, {
    status: 'ready', size_bytes: obj.size, duration_seconds: Math.round(num(duration) || 0),
    orientation: vertical ? 'vertical' : 'horizontal', max_quality: quality
  });
  return ok();
});

route('POST', '/videos/(\\d+)/upload/abort', async (c, id) => {
  const v = await adminVideo(c, id);
  const { uploadId } = await c.body();
  if (uploadId) await c.env.MEDIA.resumeMultipartUpload(v.video_key, uploadId).abort().catch(() => {});
  await c.D.update('studio_videos', `id=eq.${id}`, { status: 'error' });
  return ok();
});

route('DELETE', '/videos/(\\d+)', async (c, id) => {
  const v = await adminVideo(c, id);
  await deleteMediaPrefix(c.env, `videos/${v.storage_key}/`);
  await c.D.remove('studio_videos', `id=eq.${id}`);
  return ok();
});

// ---------------------------------------------------------------------------
// Álbuns, seções e fotos
// ---------------------------------------------------------------------------
const ALBUM_COLUMNS = 'id,storage_key,title,description,category,cover_key,owner_user_id,created_at';

async function albumSummary(env, a) {
  const token = await mediaToken(env, `albums/${a.storage_key}/`);
  return { id: a.id, title: a.title, description: a.description, category: a.category, owner_user_id: a.owner_user_id, created_at: a.created_at, cover_url: mediaUrl(a.cover_key, token) };
}

function photoOut(p, token) {
  return {
    id: p.id, section_id: p.section_id, original_name: p.original_name, position: p.position,
    source: p.source, uploader_name: p.uploader_name, size_bytes: p.size_bytes,
    url: mediaUrl(p.photo_key, token), thumb_url: mediaUrl(p.thumb_key, token),
    download_url: mediaUrl(p.photo_key, token, p.original_name || `foto-${p.id}.jpg`)
  };
}

async function albumDetail(c, album, { onlySectionId } = {}) {
  const token = await mediaToken(c.env, `albums/${album.storage_key}/`);
  const sectionFilter = onlySectionId ? `&id=eq.${onlySectionId}` : '';
  const [sections, photos] = await Promise.all([
    c.D.list('studio_sections', `select=*&album_id=eq.${album.id}${sectionFilter}&order=position.asc,id.asc`),
    c.D.list('studio_photos', `select=*&album_id=eq.${album.id}${onlySectionId ? `&section_id=eq.${onlySectionId}` : ''}&order=position.asc,id.asc`)
  ]);
  const out = photos.map(p => photoOut(p, token));
  return {
    id: album.id, title: album.title, description: album.description, category: album.category,
    owner_user_id: album.owner_user_id, cover_url: mediaUrl(album.cover_key, token),
    sections: sections.map(s => ({
      id: s.id, title: s.title, description: s.description, position: s.position,
      cover_url: mediaUrl(s.cover_key, token),
      photos: out.filter(p => p.section_id === s.id)
    })),
    photos: onlySectionId ? [] : out.filter(p => !p.section_id),
    allPhotosCount: photos.length
  };
}

async function getAlbum(c, id) {
  const a = await c.D.one('studio_albums', `select=*&id=eq.${id}`);
  if (!a) throw new HttpError(404, 'Álbum não encontrado');
  return a;
}

async function ownerOrAdmin(c, album) {
  const u = await c.auth();
  if (!(u.isAdmin || album.owner_user_id === u.id)) throw new HttpError(403, 'Sem acesso a este álbum');
  return u;
}

route('GET', '/albums/portfolio', async (c) => {
  const rows = await c.D.list('studio_albums', `select=${ALBUM_COLUMNS}&owner_user_id=is.null&order=created_at.desc`);
  return json(await Promise.all(rows.map(a => albumSummary(c.env, a))));
});

route('GET', '/albums', async (c) => {
  const u = await c.auth();
  const filter = u.isAdmin ? '' : `&owner_user_id=eq.${u.id}`;
  const rows = await c.D.list('studio_albums', `select=${ALBUM_COLUMNS}${filter}&order=created_at.desc`);
  return json(await Promise.all(rows.map(a => albumSummary(c.env, a))));
});

route('GET', '/albums/(\\d+)', async (c, id) => {
  const album = await getAlbum(c, id);
  if (!(await canSee(c, album.owner_user_id))) throw new HttpError(403, 'Faça login pra ver este álbum');
  return json(await albumDetail(c, album));
});

route('POST', '/albums', async (c) => {
  await c.admin();
  const { title, description, category, ownerUserId } = await c.body();
  if (!title) throw new HttpError(400, 'Título é obrigatório');
  const a = await c.D.insert('studio_albums', {
    title, description: description || '', category: category || 'Casamentos',
    owner_user_id: isUuid(ownerUserId) ? ownerUserId : null
  });
  return ok({ id: a.id });
});

route('PATCH', '/albums/(\\d+)', async (c, id) => {
  await c.admin();
  const { title, description, category, ownerUserId } = await c.body();
  const patch = { owner_user_id: isUuid(ownerUserId) ? ownerUserId : null };
  if (title) patch.title = title;
  if (description !== undefined) patch.description = description;
  if (category) patch.category = category;
  await c.D.update('studio_albums', `id=eq.${id}`, patch);
  return ok();
});

route('DELETE', '/albums/(\\d+)', async (c, id) => {
  await c.admin();
  const album = await getAlbum(c, id);
  await deleteMediaPrefix(c.env, `albums/${album.storage_key}/`);
  await c.D.remove('studio_share_links', `resource_type=eq.album&resource_id=eq.${id}`);
  await c.D.remove('studio_albums', `id=eq.${id}`);
  return ok();
});

route('POST', '/albums/(\\d+)/sections', async (c, id) => {
  await c.admin();
  await getAlbum(c, id);
  const { title, description } = await c.body();
  if (!title) throw new HttpError(400, 'Título da seção é obrigatório');
  const position = await nextPosition(c.D, 'studio_sections', `album_id=eq.${id}`);
  const s = await c.D.insert('studio_sections', { album_id: Number(id), title, description: description || '', position });
  return ok({ id: s.id });
});

route('PATCH', '/albums/(\\d+)/sections/(\\d+)', async (c, id, sectionId) => {
  await c.admin();
  const { title, description } = await c.body();
  const patch = {};
  if (title) patch.title = title;
  if (description !== undefined) patch.description = description;
  await c.D.update('studio_sections', `id=eq.${sectionId}&album_id=eq.${id}`, patch);
  return ok();
});

route('DELETE', '/albums/(\\d+)/sections/(\\d+)', async (c, id, sectionId) => {
  await c.admin();
  // As fotos da seção continuam no álbum, como "fotos gerais"
  await c.D.remove('studio_sections', `id=eq.${sectionId}&album_id=eq.${id}`);
  return ok();
});

// Envio de foto em duas etapas: 1) o arquivo original  2) a miniatura (gerada no navegador), que registra a foto
async function receivePhotoFile(c, album, { guest = false, uploaderName = '' } = {}) {
  const kind = c.url.searchParams.get('kind');
  const name = (c.url.searchParams.get('name') || 'foto.jpg').slice(0, 160);
  const base = `albums/${album.storage_key}/${guest ? 'convidados/' : ''}`;

  if (kind === 'photo') {
    const ct = c.request.headers.get('Content-Type') || '';
    if (guest && !ct.startsWith('image/')) throw new HttpError(400, 'Envie apenas fotos');
    const ext = extOf(name) || 'jpg';
    const key = `${base}${Date.now()}-${randomId()}.${ext}`;
    await putBody(c.env, c.request, key, guest ? GUEST_MAX_BYTES : 0);
    return ok({ key });
  }

  if (kind === 'thumb') {
    const photoKey = c.url.searchParams.get('for') || '';
    if (!photoKey.startsWith(base) || photoKey.includes('..') || photoKey.slice(base.length).includes('/')) throw new HttpError(400, 'Foto inválida');
    const original = await c.env.MEDIA.head(photoKey);
    if (!original) throw new HttpError(400, 'Envie a foto antes da miniatura');
    const thumbKey = `${base}miniaturas/${photoKey.slice(base.length).replace(/\.[^.]+$/, '')}.jpg`;
    await putBody(c.env, c.request, thumbKey, 5 * 1024 * 1024);

    let sectionId = num(c.url.searchParams.get('section'));
    if (guest) sectionId = await guestSectionId(c, album);
    else if (sectionId && !(await c.D.one('studio_sections', `select=id&id=eq.${sectionId}&album_id=eq.${album.id}`))) sectionId = null;

    const position = await nextPosition(c.D, 'studio_photos', `album_id=eq.${album.id}`);
    const photo = await c.D.insert('studio_photos', {
      album_id: album.id, section_id: sectionId || null, photo_key: photoKey, thumb_key: thumbKey,
      original_name: name, size_bytes: original.size, position,
      source: guest ? 'guest' : 'studio', uploader_name: uploaderName
    });
    if (!album.cover_key && !guest) await c.D.update('studio_albums', `id=eq.${album.id}`, { cover_key: thumbKey });
    if (sectionId) await c.D.update('studio_sections', `id=eq.${sectionId}&cover_key=eq.`, { cover_key: thumbKey });
    return ok({ id: photo.id });
  }
  throw new HttpError(400, 'Tipo de envio inválido');
}

async function guestSectionId(c, album) {
  const title = 'Fotos dos convidados';
  const existing = await c.D.one('studio_sections', `select=id&album_id=eq.${album.id}&title=eq.${enc(title)}`);
  if (existing) return existing.id;
  const position = await nextPosition(c.D, 'studio_sections', `album_id=eq.${album.id}`);
  const s = await c.D.insert('studio_sections', { album_id: album.id, title, description: 'Momentos capturados pelos próprios convidados durante a festa', position });
  return s.id;
}

route('PUT', '/albums/(\\d+)/files', async (c, id) => {
  await c.admin();
  return receivePhotoFile(c, await getAlbum(c, id));
});

route('DELETE', '/albums/(\\d+)/photos/(\\d+)', async (c, id, photoId) => {
  await c.admin();
  const p = await c.D.one('studio_photos', `select=*&id=eq.${photoId}&album_id=eq.${id}`);
  if (!p) throw new HttpError(404, 'Foto não encontrada');
  await c.env.MEDIA.delete([p.photo_key, p.thumb_key]);
  await c.D.remove('studio_photos', `id=eq.${photoId}`);
  return ok();
});

// Comentários: só o cliente dono do álbum e o admin
route('GET', '/albums/(\\d+)/comments', async (c, id) => {
  await ownerOrAdmin(c, await getAlbum(c, id));
  const rows = await c.D.list('studio_comments', `select=id,body,photo_id,created_at,author_email&album_id=eq.${id}&order=created_at.asc`);
  return json(rows.map(r => ({ ...r, author: r.author_email })));
});

route('POST', '/albums/(\\d+)/comments', async (c, id) => {
  const u = await ownerOrAdmin(c, await getAlbum(c, id));
  const { body, photoId } = await c.body();
  if (!body || !String(body).trim()) throw new HttpError(400, 'Escreva algo pra comentar');
  const row = await c.D.insert('studio_comments', {
    album_id: Number(id), photo_id: num(photoId), user_id: u.id, author_email: u.email, body: String(body).trim().slice(0, 4000)
  });
  return ok({ id: row.id });
});

// Links de compartilhamento (álbum inteiro ou uma seção)
async function upsertShare(c, type, resourceId, allowDownload) {
  const existing = await c.D.one('studio_share_links', `select=*&resource_type=eq.${type}&resource_id=eq.${resourceId}`);
  if (existing) {
    await c.D.update('studio_share_links', `id=eq.${existing.id}`, { allow_download: !!allowDownload });
    return existing.token;
  }
  const token = crypto.randomUUID();
  await c.D.insert('studio_share_links', { token, resource_type: type, resource_id: Number(resourceId), allow_download: !!allowDownload });
  return token;
}

route('POST', '/albums/(\\d+)/share', async (c, id) => {
  await ownerOrAdmin(c, await getAlbum(c, id));
  const { allowDownload } = await c.body();
  return ok({ token: await upsertShare(c, 'album', id, allowDownload) });
});

route('POST', '/albums/(\\d+)/sections/(\\d+)/share', async (c, id, sectionId) => {
  await ownerOrAdmin(c, await getAlbum(c, id));
  if (!(await c.D.one('studio_sections', `select=id&id=eq.${sectionId}&album_id=eq.${id}`))) throw new HttpError(404, 'Seção não encontrada');
  const { allowDownload } = await c.body();
  return ok({ token: await upsertShare(c, 'section', sectionId, allowDownload) });
});

route('DELETE', '/albums/share/([\\w-]+)', async (c, token) => {
  const link = await c.D.one('studio_share_links', `select=*&token=eq.${enc(token)}`);
  if (!link) return ok();
  const albumId = link.resource_type === 'album' ? link.resource_id
    : (await c.D.one('studio_sections', `select=album_id&id=eq.${link.resource_id}`))?.album_id;
  if (albumId) await ownerOrAdmin(c, await getAlbum(c, albumId));
  else await c.admin();
  await c.D.remove('studio_share_links', `id=eq.${link.id}`);
  return ok();
});

route('GET', '/albums/share/([\\w-]+)', async (c, token) => {
  const link = await c.D.one('studio_share_links', `select=*&token=eq.${enc(token)}`);
  if (!link) throw new HttpError(404, 'Link inválido ou expirado');
  let album, detail;
  if (link.resource_type === 'album') {
    album = await getAlbum(c, link.resource_id);
    detail = await albumDetail(c, album);
  } else {
    const section = await c.D.one('studio_sections', `select=*&id=eq.${link.resource_id}`);
    if (!section) throw new HttpError(404, 'Seção não encontrada');
    album = await getAlbum(c, section.album_id);
    detail = await albumDetail(c, album, { onlySectionId: section.id });
    detail.title = section.title;
    detail.description = section.description;
  }
  const strip = (p) => ({ ...p, download_url: link.allow_download ? p.download_url : '' });
  return json({
    type: link.resource_type, title: detail.title, description: detail.description,
    sections: detail.sections.map(s => ({ ...s, photos: s.photos.map(strip) })),
    photos: detail.photos.map(strip),
    allowDownload: !!link.allow_download
  });
});

// Envio de fotos pelos convidados (link ou QR code na festa)
route('POST', '/albums/(\\d+)/guest-upload/toggle', async (c, id) => {
  const album = await getAlbum(c, id);
  await ownerOrAdmin(c, album);
  const { enabled } = await c.body();
  const token = album.guest_upload_token || crypto.randomUUID();
  await c.D.update('studio_albums', `id=eq.${id}`, { guest_upload_enabled: !!enabled, guest_upload_token: token });
  return ok({ token: enabled ? token : null });
});

async function guestAlbum(c, token) {
  const album = await c.D.one('studio_albums', `select=*&guest_upload_token=eq.${enc(token)}&guest_upload_enabled=is.true`);
  if (!album) throw new HttpError(404, 'Link de envio inválido ou desativado');
  return album;
}

route('GET', '/albums/guest-upload/([\\w-]+)', async (c, token) => {
  const album = await guestAlbum(c, token);
  return json({ id: album.id, title: album.title });
});

route('PUT', '/albums/guest-upload/([\\w-]+)/files', async (c, token) => {
  const album = await guestAlbum(c, token);
  const uploaderName = (c.url.searchParams.get('uploader') || 'Convidado').slice(0, 60);
  return receivePhotoFile(c, album, { guest: true, uploaderName });
});

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------
async function emailsById(c, ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await c.D.list('studio_profiles', `select=user_id,email&user_id=in.(${unique.join(',')})`);
  return Object.fromEntries(rows.map(r => [r.user_id, r.email]));
}

route('GET', '/contracts', async (c) => {
  await c.admin();
  const rows = await c.D.list('studio_contracts', 'select=id,owner_user_id,title,status,signed_at,created_at&order=created_at.desc');
  const emails = await emailsById(c, rows.map(r => r.owner_user_id));
  return json(rows.map(r => ({ ...r, owner_email: emails[r.owner_user_id] || '—' })));
});

route('GET', '/contracts/mine', async (c) => {
  const u = await c.auth();
  return json(await c.D.list('studio_contracts', `select=*&owner_user_id=eq.${u.id}&order=created_at.desc`));
});

route('GET', '/contracts/(\\d+)', async (c, id) => {
  const u = await c.auth();
  const row = await c.D.one('studio_contracts', `select=*&id=eq.${id}`);
  if (!row || !(u.isAdmin || row.owner_user_id === u.id)) throw new HttpError(404, 'Contrato não encontrado');
  return json(row);
});

route('POST', '/contracts', async (c) => {
  await c.admin();
  const { ownerUserId, title, body, events } = await c.body();
  if (!isUuid(ownerUserId) || !title) throw new HttpError(400, 'Cliente e título são obrigatórios');
  const cleanEvents = (Array.isArray(events) ? events : []).map(ev => ({
    title: String(ev.title || ''), event_date: String(ev.event_date || ''),
    items: (Array.isArray(ev.items) ? ev.items : []).map(String)
  }));
  const row = await c.D.insert('studio_contracts', { owner_user_id: ownerUserId, title, body: body || '', events: cleanEvents });
  return ok({ id: row.id });
});

route('DELETE', '/contracts/(\\d+)', async (c, id) => {
  await c.admin();
  await c.D.remove('studio_contracts', `id=eq.${id}`);
  return ok();
});

route('POST', '/contracts/(\\d+)/sign', async (c, id) => {
  const u = await c.auth();
  const row = await c.D.one('studio_contracts', `select=*&id=eq.${id}`);
  if (!row || row.owner_user_id !== u.id) throw new HttpError(403, 'Sem acesso a este contrato');
  if (row.status === 'signed') throw new HttpError(400, 'Este contrato já foi assinado');
  const { signerName, signatureDataUrl } = await c.body();
  if (!signerName || !String(signatureDataUrl || '').startsWith('data:image/png;base64,')) throw new HttpError(400, 'Nome e assinatura são obrigatórios');
  if (signatureDataUrl.length > 1_500_000) throw new HttpError(400, 'Assinatura grande demais');
  await c.D.update('studio_contracts', `id=eq.${id}&status=eq.pending`, {
    status: 'signed', signer_name: String(signerName).slice(0, 200), signature_data_url: signatureDataUrl, signed_at: new Date().toISOString()
  });
  return ok();
});

// ---------------------------------------------------------------------------
// Pacotes, produtos e Mercado Pago
// ---------------------------------------------------------------------------
async function packagesWithItems(c, filter = '') {
  const [packages, items] = await Promise.all([
    c.D.list('studio_packages', `select=*${filter}&order=position.asc,id.asc`),
    c.D.list('studio_package_items', 'select=*&order=position.asc,id.asc')
  ]);
  return packages.map(p => {
    const own = items.filter(i => i.package_id === p.id).map(i => ({ ...i, price: Number(i.price), default_included: i.default_included ? 1 : 0 }));
    return { ...p, items: own, basePrice: own.filter(i => i.default_included).reduce((s, i) => s + i.price, 0) };
  });
}

route('GET', '/packages', async (c) => json(await packagesWithItems(c)));

route('POST', '/packages', async (c) => {
  await c.admin();
  const { title, description, items } = await c.body();
  if (!title) throw new HttpError(400, 'Título é obrigatório');
  const position = await nextPosition(c.D, 'studio_packages', '');
  const pkg = await c.D.insert('studio_packages', { title, description: description || '', position });
  await c.D.insertMany('studio_package_items', (Array.isArray(items) ? items : []).map((it, i) => ({
    package_id: pkg.id, label: String(it.label || ''), price: num(it.price) || 0, default_included: !!it.defaultIncluded, position: i
  })));
  return ok({ id: pkg.id });
});

route('DELETE', '/packages/(\\d+)', async (c, id) => {
  await c.admin();
  await c.D.remove('studio_packages', `id=eq.${id}`);
  return ok();
});

route('GET', '/packages/orders/all', async (c) => {
  await c.admin();
  const rows = await c.D.list('studio_orders', 'select=*&order=created_at.desc');
  return json(rows.map(o => ({ ...o, total: Number(o.total) })));
});

async function createPreference(c, { title, quantity, unitPrice, payerName, payerEmail, reference, failurePath, webhookPath }) {
  if (!c.env.MP_ACCESS_TOKEN) throw new HttpError(500, 'Mercado Pago não configurado (MP_ACCESS_TOKEN)');
  const site = String(c.env.SITE_URL || `${c.url.origin}${BASE}`).replace(/\/$/, '');
  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.env.MP_ACCESS_TOKEN}` },
    body: JSON.stringify({
      items: [{ title: `${title} — Duna`, quantity, unit_price: unitPrice, currency_id: 'BRL' }],
      payer: payerEmail ? { name: payerName || undefined, email: payerEmail } : undefined,
      external_reference: reference,
      back_urls: { success: `${site}/checkout-sucesso.html`, pending: `${site}/checkout-sucesso.html`, failure: `${site}/${failurePath}` },
      auto_return: 'approved',
      notification_url: `${site}/api/${webhookPath}`
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('[dunastudio] Mercado Pago', res.status, JSON.stringify(data)); throw new HttpError(502, 'Erro ao criar o pagamento no Mercado Pago'); }
  return data;
}

route('POST', '/packages/(\\d+)/checkout', async (c, id) => {
  const [pkg] = await packagesWithItems(c, `&id=eq.${id}`);
  if (!pkg) throw new HttpError(404, 'Pacote não encontrado');
  const { selectedItemIds, payerName, payerEmail } = await c.body();
  // O valor é sempre recalculado aqui; nunca vem do navegador
  const chosenIds = Array.isArray(selectedItemIds) && selectedItemIds.length
    ? selectedItemIds.map(Number) : pkg.items.filter(i => i.default_included).map(i => i.id);
  const chosen = pkg.items.filter(i => chosenIds.includes(i.id));
  const total = Math.round(chosen.reduce((s, i) => s + i.price, 0) * 100) / 100;
  if (total <= 0) throw new HttpError(400, 'Selecione ao menos um item com valor');

  const order = await c.D.insert('studio_orders', {
    package_id: pkg.id, package_title: pkg.title, selected_items: chosen.map(i => i.label), total,
    payer_name: payerName || '', payer_email: payerEmail || ''
  });
  const pref = await createPreference(c, {
    title: pkg.title, quantity: 1, unitPrice: total, payerName, payerEmail,
    reference: `package-${order.id}`, failurePath: 'pacotes.html', webhookPath: 'packages/webhook'
  });
  await c.D.update('studio_orders', `id=eq.${order.id}`, { mp_preference_id: pref.id });
  return ok({ checkoutUrl: pref.init_point });
});

route('GET', '/products', async (c) => {
  const rows = await c.D.list('studio_products', 'select=*&order=position.asc,id.asc');
  return json(rows.map(p => ({ ...p, price: Number(p.price) })));
});

route('POST', '/products', async (c) => {
  await c.admin();
  const { title, description, price } = await c.body();
  const value = num(String(price ?? '').replace(',', '.'));
  if (!title || !value) throw new HttpError(400, 'Título e preço são obrigatórios');
  const position = await nextPosition(c.D, 'studio_products', '');
  const row = await c.D.insert('studio_products', { title, description: description || '', price: value, position });
  return ok({ id: row.id });
});

route('DELETE', '/products/(\\d+)', async (c, id) => {
  await c.admin();
  await c.D.remove('studio_products', `id=eq.${id}`);
  return ok();
});

route('GET', '/products/orders/all', async (c) => {
  await c.admin();
  const rows = await c.D.list('studio_product_orders', 'select=*&order=created_at.desc');
  return json(rows.map(o => ({ ...o, total: Number(o.total) })));
});

route('POST', '/products/(\\d+)/order', async (c, id) => {
  const product = await c.D.one('studio_products', `select=*&id=eq.${id}`);
  if (!product) throw new HttpError(404, 'Produto não encontrado');
  const { photoId, albumId, quantity, payerName, payerEmail } = await c.body();
  const qty = Math.min(50, Math.max(1, Math.floor(Number(quantity) || 1)));
  const price = Number(product.price);
  const order = await c.D.insert('studio_product_orders', {
    product_id: product.id, product_title: product.title, album_id: num(albumId), photo_id: num(photoId),
    quantity: qty, total: Math.round(price * qty * 100) / 100, payer_name: payerName || '', payer_email: payerEmail || ''
  });
  const pref = await createPreference(c, {
    title: product.title, quantity: qty, unitPrice: price, payerName, payerEmail,
    reference: `product-${order.id}`, failurePath: '', webhookPath: 'products/webhook'
  });
  await c.D.update('studio_product_orders', `id=eq.${order.id}`, { mp_preference_id: pref.id });
  return ok({ checkoutUrl: pref.init_point });
});

// O Mercado Pago avisa aqui quando um pagamento muda de status. O status é sempre conferido na API do MP.
async function handlePaymentNotice(c) {
  const body = c.request.method === 'POST' ? await c.body() : {};
  const paymentId = body?.data?.id || c.url.searchParams.get('data.id') || (c.url.searchParams.get('topic') === 'payment' ? c.url.searchParams.get('id') : null);
  const topic = body?.type || c.url.searchParams.get('type') || c.url.searchParams.get('topic');
  if (topic !== 'payment' || !paymentId || !c.env.MP_ACCESS_TOKEN) return;

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${enc(paymentId)}`, { headers: { Authorization: `Bearer ${c.env.MP_ACCESS_TOKEN}` } });
  if (!res.ok) return;
  const payment = await res.json();
  const [kind, orderId] = String(payment.external_reference || '').split('-');
  const table = kind === 'package' ? 'studio_orders' : kind === 'product' ? 'studio_product_orders' : null;
  if (!table || !num(orderId)) return;

  const order = await c.D.one(table, `select=*&id=eq.${orderId}`);
  if (!order) return;
  const status = payment.status === 'approved' ? 'approved' : String(payment.status || 'pending');
  await c.D.update(table, `id=eq.${order.id}`, { status, mp_payment_id: String(paymentId) });
  if (status === 'approved' && order.status !== 'approved') {
    const title = kind === 'package' ? order.package_title : `Produto físico: ${order.product_title} (x${order.quantity})`;
    const items = kind === 'package' ? (order.selected_items || []) : [];
    await sendSaleEmail(c.env, { id: order.id, title, total: Number(order.total), payerName: order.payer_name, payerEmail: order.payer_email, items });
  }
}

async function sendSaleEmail(env, sale) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL) return;
  const text = [
    `Venda: ${sale.title}`, `Valor: R$ ${sale.total.toFixed(2)}`,
    `Cliente: ${sale.payerName || '—'} (${sale.payerEmail || '—'})`,
    sale.items.length ? `\nItens:\n${sale.items.map(i => `- ${i}`).join('\n')}` : '',
    `\nPedido: ${sale.id}`
  ].join('\n');
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM || 'Duna Studio <onboarding@resend.dev>', to: [env.NOTIFY_EMAIL], subject: `Novo pagamento aprovado — ${sale.title}`, text })
  }).catch(err => console.error('[dunastudio] e-mail', err));
}

for (const kind of ['packages', 'products']) {
  for (const method of ['GET', 'POST']) {
    route(method, `/${kind}/webhook`, (c) => {
      c.ctx.waitUntil(handlePaymentNotice(c).catch(err => console.error('[dunastudio] webhook', err)));
      return new Response('ok');
    });
  }
}

// ---------------------------------------------------------------------------
// Depoimentos
// ---------------------------------------------------------------------------
route('GET', '/testimonials/portfolio', async (c) => {
  return json(await c.D.list('studio_testimonials', 'select=client_name,quote,photo_url&approved=is.true&order=created_at.desc'));
});

route('GET', '/testimonials', async (c) => {
  await c.admin();
  return json(await c.D.list('studio_testimonials', 'select=*&order=created_at.desc'));
});

route('POST', '/testimonials', async (c) => {
  const u = await c.auth();
  const { clientName, quote, photoUrl } = await c.body();
  if (!clientName || !quote) throw new HttpError(400, 'Nome e depoimento são obrigatórios');
  const photo = /^https:\/\//.test(photoUrl || '') ? String(photoUrl).slice(0, 500) : '';
  const row = await c.D.insert('studio_testimonials', {
    owner_user_id: u.id, owner_email: u.email, client_name: String(clientName).slice(0, 120), quote: String(quote).slice(0, 2000), photo_url: photo
  });
  return ok({ id: row.id });
});

route('PATCH', '/testimonials/(\\d+)/approve', async (c, id) => {
  await c.admin();
  await c.D.update('studio_testimonials', `id=eq.${id}`, { approved: true });
  return ok();
});

route('DELETE', '/testimonials/(\\d+)', async (c, id) => {
  await c.admin();
  await c.D.remove('studio_testimonials', `id=eq.${id}`);
  return ok();
});
