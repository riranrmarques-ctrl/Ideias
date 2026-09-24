// Base comum de todas as páginas do DunaStudio:
// - conecta no Supabase (login) com a configuração que o Worker entrega em api/config
// - coloca o token de login em toda chamada para api/... (o Worker confere quem é o usuário)
// - funções de envio de fotos (com miniatura gerada no navegador)
(function () {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  let client = null;

  window.studioReady = (async () => {
    try {
      const res = await nativeFetch('api/config', { cache: 'no-store' });
      const cfg = await res.json();
      if (window.supabase && cfg.supabaseUrl && cfg.supabaseAnonKey) {
        client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, storageKey: 'dunastudio-auth' }
        });
      }
    } catch (err) {
      console.error('[studio] Falha ao carregar a configuração', err);
    }
    return client;
  })();

  window.studioClient = () => window.studioReady;

  async function accessToken() {
    const c = await window.studioReady;
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data?.session?.access_token || null;
  }
  window.studioAccessToken = accessToken;

  function isApiCall(input) {
    const raw = typeof input === 'string' ? input : input && input.url;
    if (!raw) return false;
    const url = new URL(raw, window.location.href);
    return url.origin === window.location.origin && url.pathname.includes('/api/') && !url.pathname.includes('/api/media/');
  }

  window.fetch = async function (input, init = {}) {
    if (!isApiCall(input)) return nativeFetch(input, init);
    const token = await accessToken();
    const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    return nativeFetch(input, { ...init, headers });
  };

  // ---------- Fotos: miniatura no navegador + envio em duas etapas ----------
  async function makeThumbnail(file, maxSide = 900) {
    let source;
    try {
      source = await createImageBitmap(file);
    } catch {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    }
    const w = source.width, h = source.height;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  }

  // baseUrl: "api/albums/12/files" (admin) ou "api/albums/guest-upload/TOKEN/files" (convidados)
  async function uploadPhoto(baseUrl, file, extraParams = {}) {
    const thumb = await makeThumbnail(file);
    const params = new URLSearchParams({ ...extraParams, name: file.name || 'foto.jpg' });

    const photoRes = await fetch(`${baseUrl}?kind=photo&${params}`, {
      method: 'PUT', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file
    });
    const photoData = await photoRes.json().catch(() => ({}));
    if (!photoRes.ok) throw new Error(photoData.error || `Falha ao enviar ${file.name}`);

    params.set('for', photoData.key);
    const thumbRes = await fetch(`${baseUrl}?kind=thumb&${params}`, {
      method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: thumb
    });
    const thumbData = await thumbRes.json().catch(() => ({}));
    if (!thumbRes.ok) throw new Error(thumbData.error || `Falha ao registrar ${file.name}`);
    return thumbData;
  }

  // Envia várias fotos, 3 de cada vez. onProgress(enviadas, total, falhas)
  window.studioUploadPhotos = async function (baseUrl, files, extraParams, onProgress) {
    const list = Array.from(files);
    let done = 0, failed = 0, next = 0;
    const errors = [];
    async function worker() {
      while (next < list.length) {
        const file = list[next++];
        try { await uploadPhoto(baseUrl, file, extraParams); }
        catch (err) { failed++; errors.push(err.message); }
        done++;
        if (onProgress) onProgress(done, list.length, failed);
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return { done, failed, errors };
  };
})();
