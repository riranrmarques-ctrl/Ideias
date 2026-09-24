const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver');
const { db, newStorageKey } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { uploadFile, deletePrefix, getObjectStream } = require('../utils/r2');
const { makeThumbnail } = require('../utils/thumbnail');

const router = express.Router();
const upload = multer({ dest: path.join(os.tmpdir(), 'wedding-flix-photo-uploads') });

const ALBUM_COLUMNS = `id, title, description, category, cover_url, owner_user_id, created_at`;

function canAccessAlbum(album, user) {
  if (!album) return false;
  if (user?.isAdmin) return true;
  return album.owner_user_id === user?.userId || album.owner_user_id === null;
}

// Portfólio público — álbuns marcados como públicos
router.get('/portfolio', (req, res) => {
  const albums = db.prepare(`SELECT ${ALBUM_COLUMNS} FROM albums WHERE owner_user_id IS NULL ORDER BY created_at DESC`).all();
  res.json(albums);
});

// "Minha área" — cliente vê só os próprios álbuns; admin vê todos
router.get('/', requireAuth, (req, res) => {
  const albums = req.user.isAdmin
    ? db.prepare(`SELECT ${ALBUM_COLUMNS} FROM albums ORDER BY created_at DESC`).all()
    : db.prepare(`SELECT ${ALBUM_COLUMNS} FROM albums WHERE owner_user_id = ? ORDER BY created_at DESC`).all(req.user.userId);
  res.json(albums);
});

// Detalhe do álbum + fotos, agrupadas por seção (anônimo pode ver se for público)
router.get('/:id', require('../middleware/auth').optionalAuth, (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
  const isPublic = album.owner_user_id === null;
  const isOwner = req.user && album.owner_user_id === req.user.userId;
  const isAdmin = req.user?.isAdmin;
  if (!isPublic && !isOwner && !isAdmin) return res.status(403).json({ error: 'Faça login pra ver este álbum' });

  const sections = db.prepare('SELECT * FROM sections WHERE album_id = ? ORDER BY position ASC, id ASC').all(album.id);
  const allPhotos = db.prepare('SELECT id, url, thumb_url, original_name, position, section_id FROM photos WHERE album_id = ? ORDER BY position ASC, id ASC').all(album.id);

  const sectionsWithPhotos = sections.map(s => ({
    ...s,
    photos: allPhotos.filter(p => p.section_id === s.id)
  }));
  const ungroupedPhotos = allPhotos.filter(p => !p.section_id);

  res.json({ ...album, sections: sectionsWithPhotos, photos: ungroupedPhotos, allPhotosCount: allPhotos.length });
});

// Admin: cria o álbum (metadados). ownerUserId vazio = álbum público do portfólio.
router.post('/', requireAdmin, (req, res) => {
  const { title, description, category, ownerUserId } = req.body;
  if (!title) return res.status(400).json({ error: 'Título é obrigatório' });
  const storageKey = newStorageKey();
  const info = db.prepare(`
    INSERT INTO albums (storage_key, title, description, category, owner_user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(storageKey, title, description || '', category || 'Casamentos', ownerUserId ? Number(ownerUserId) : null);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.patch('/:id', requireAdmin, (req, res) => {
  const { title, description, category, ownerUserId } = req.body;
  db.prepare(`
    UPDATE albums SET title = COALESCE(?, title), description = COALESCE(?, description),
      category = COALESCE(?, category), owner_user_id = ? WHERE id = ?
  `).run(title, description, category, ownerUserId ? Number(ownerUserId) : null, req.params.id);
  res.json({ ok: true });
});

// Admin: cria uma seção/subtítulo dentro do álbum (ex: Making-of, Pré-wedding, Recepção)
router.post('/:id/sections', requireAdmin, (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Título da seção é obrigatório' });
  const position = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM sections WHERE album_id = ?').get(album.id).maxPos + 1;
  const info = db.prepare(`
    INSERT INTO sections (album_id, title, description, position) VALUES (?, ?, ?, ?)
  `).run(album.id, title, description || '', position);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.patch('/:id/sections/:sectionId', requireAdmin, (req, res) => {
  const { title, description } = req.body;
  db.prepare(`
    UPDATE sections SET title = COALESCE(?, title), description = COALESCE(?, description)
    WHERE id = ? AND album_id = ?
  `).run(title, description, req.params.sectionId, req.params.id);
  res.json({ ok: true });
});

// Exclui a seção mas preserva as fotos (elas voltam a ficar "sem seção")
router.delete('/:id/sections/:sectionId', requireAdmin, (req, res) => {
  db.prepare('UPDATE photos SET section_id = NULL WHERE section_id = ?').run(req.params.sectionId);
  db.prepare('DELETE FROM sections WHERE id = ? AND album_id = ?').run(req.params.sectionId, req.params.id);
  res.json({ ok: true });
});

// Admin: adiciona fotos a um álbum já criado (múltiplos arquivos de uma vez).
// sectionId opcional no corpo do formulário — associa as fotos a uma seção (Make-of, Pré-wedding etc.)
router.post('/:id/photos', requireAdmin, upload.array('photos', 200), async (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Nenhuma foto enviada' });
  const sectionId = req.body.sectionId ? Number(req.body.sectionId) : null;
  const section = sectionId ? db.prepare('SELECT * FROM sections WHERE id = ? AND album_id = ?').get(sectionId, album.id) : null;

  res.json({ ok: true, uploading: files.length });

  let position = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM photos WHERE album_id = ?').get(album.id).maxPos + 1;

  for (const file of files) {
    try {
      const ext = path.extname(file.originalname) || '.jpg';
      const photoKey = `albums/${album.storage_key}/${Date.now()}-${position}${ext}`;
      const thumbKey = `albums/${album.storage_key}/thumbs/${Date.now()}-${position}.jpg`;
      const thumbPath = path.join(os.tmpdir(), `thumb-${Date.now()}-${position}.jpg`);

      await makeThumbnail(file.path, thumbPath);
      const [url, thumbUrl] = await Promise.all([
        uploadFile(file.path, photoKey),
        uploadFile(thumbPath, thumbKey)
      ]);

      db.prepare(`
        INSERT INTO photos (album_id, section_id, url, r2_key, thumb_url, original_name, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(album.id, sectionId, url, photoKey, thumbUrl, file.originalname, position);

      if (!album.cover_url) {
        db.prepare('UPDATE albums SET cover_url = ?, cover_r2_key = ? WHERE id = ?').run(thumbUrl, thumbKey, album.id);
        album.cover_url = thumbUrl;
      }
      if (section && !section.cover_url) {
        db.prepare('UPDATE sections SET cover_url = ?, cover_r2_key = ? WHERE id = ?').run(thumbUrl, thumbKey, section.id);
        section.cover_url = thumbUrl;
      }

      fs.unlink(file.path, () => {});
      fs.unlink(thumbPath, () => {});
      position++;
    } catch (err) {
      console.error(`[wedding-flix] Falha ao processar foto ${file.originalname}:`, err);
      fs.unlink(file.path, () => {});
    }
  }
});

router.delete('/:id/photos/:photoId', requireAdmin, async (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ? AND album_id = ?').get(req.params.photoId, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Foto não encontrada' });
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  db.prepare('DELETE FROM comments WHERE photo_id = ?').run(photo.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album) return res.status(404).json({ error: 'Não encontrado' });
  await deletePrefix(`albums/${album.storage_key}`).catch(() => {});
  db.prepare('DELETE FROM comments WHERE album_id = ?').run(album.id);
  db.prepare('DELETE FROM photos WHERE album_id = ?').run(album.id);
  db.prepare('DELETE FROM albums WHERE id = ?').run(album.id);
  res.json({ ok: true });
});

// Download de uma foto individual (força o download, em resolução original)
router.get('/photos/:photoId/download', requireAuth, async (req, res) => {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.photoId);
  if (!photo) return res.status(404).end();
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(photo.album_id);
  if (!canAccessAlbum(album, req.user)) return res.status(403).end();

  try {
    const { stream, contentType, contentLength } = await getObjectStream(photo.r2_key);
    res.setHeader('Content-Disposition', `attachment; filename="${photo.original_name || 'foto.jpg'}"`);
    if (contentType) res.setHeader('Content-Type', contentType);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao baixar a foto' });
  }
});

// Download do álbum inteiro como .zip (streaming, sem gerar arquivo temporário grande)
router.get('/:id/download', requireAuth, async (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!canAccessAlbum(album, req.user)) return res.status(403).end();
  const photos = db.prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY position ASC').all(album.id);
  if (!photos.length) return res.status(404).json({ error: 'Álbum sem fotos' });

  res.attachment(`${album.title.replace(/[^\w\-]+/g, '_')}.zip`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => res.end());
  archive.pipe(res);

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    try {
      const { stream } = await getObjectStream(photo.r2_key);
      const name = photo.original_name || `foto-${i + 1}.jpg`;
      archive.append(stream, { name });
    } catch (err) {
      console.error(`[wedding-flix] Falha ao incluir foto ${photo.id} no zip:`, err);
    }
  }
  archive.finalize();
});

// ---------- Comentários (só o cliente dono do álbum e o admin) ----------
router.get('/:id/comments', requireAuth, (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album || !(req.user.isAdmin || album.owner_user_id === req.user.userId)) {
    return res.status(403).json({ error: 'Sem acesso' });
  }
  const comments = db.prepare(`
    SELECT comments.id, comments.body, comments.photo_id, comments.created_at, users.email as author
    FROM comments JOIN users ON users.id = comments.user_id
    WHERE comments.album_id = ? ORDER BY comments.created_at ASC
  `).all(album.id);
  res.json(comments);
});

router.post('/:id/comments', requireAuth, (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album || !(req.user.isAdmin || album.owner_user_id === req.user.userId)) {
    return res.status(403).json({ error: 'Apenas o cliente dono do álbum pode comentar' });
  }
  const { body, photoId } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Escreva algo pra comentar' });
  const info = db.prepare(`
    INSERT INTO comments (album_id, photo_id, user_id, body) VALUES (?, ?, ?, ?)
  `).run(album.id, photoId || null, req.user.userId, body.trim());
  res.json({ ok: true, id: info.lastInsertRowid });
});

// ---------- Links de compartilhamento (álbum inteiro ou uma seção específica) ----------
// Só o dono do álbum ou o admin podem gerar/revogar. O link em si é público e não exige login.
router.post('/:id/share', requireAuth, (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album || !(req.user.isAdmin || album.owner_user_id === req.user.userId)) return res.status(403).json({ error: 'Sem acesso' });
  const { allowDownload } = req.body;
  const existing = db.prepare("SELECT * FROM share_links WHERE resource_type = 'album' AND resource_id = ?").get(album.id);
  if (existing) {
    db.prepare('UPDATE share_links SET allow_download = ? WHERE id = ?').run(allowDownload ? 1 : 0, existing.id);
    return res.json({ ok: true, token: existing.token });
  }
  const token = newStorageKey();
  db.prepare(`
    INSERT INTO share_links (token, resource_type, resource_id, allow_download) VALUES (?, 'album', ?, ?)
  `).run(token, album.id, allowDownload ? 1 : 0);
  res.json({ ok: true, token });
});

router.post('/:id/sections/:sectionId/share', requireAuth, (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  const section = db.prepare('SELECT * FROM sections WHERE id = ? AND album_id = ?').get(req.params.sectionId, req.params.id);
  if (!album || !section || !(req.user.isAdmin || album.owner_user_id === req.user.userId)) return res.status(403).json({ error: 'Sem acesso' });
  const { allowDownload } = req.body;
  const existing = db.prepare("SELECT * FROM share_links WHERE resource_type = 'section' AND resource_id = ?").get(section.id);
  if (existing) {
    db.prepare('UPDATE share_links SET allow_download = ? WHERE id = ?').run(allowDownload ? 1 : 0, existing.id);
    return res.json({ ok: true, token: existing.token });
  }
  const token = newStorageKey();
  db.prepare(`
    INSERT INTO share_links (token, resource_type, resource_id, allow_download) VALUES (?, 'section', ?, ?)
  `).run(token, section.id, allowDownload ? 1 : 0);
  res.json({ ok: true, token });
});

router.delete('/share/:token', requireAuth, (req, res) => {
  db.prepare('DELETE FROM share_links WHERE token = ?').run(req.params.token);
  res.json({ ok: true });
});

// Resolve um link de compartilhamento — público, sem login (usado na página /compartilhado.html)
router.get('/share/:token', (req, res) => {
  const link = db.prepare('SELECT * FROM share_links WHERE token = ?').get(req.params.token);
  if (!link) return res.status(404).json({ error: 'Link inválido ou expirado' });

  if (link.resource_type === 'album') {
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(link.resource_id);
    if (!album) return res.status(404).json({ error: 'Álbum não encontrado' });
    const sections = db.prepare('SELECT * FROM sections WHERE album_id = ? ORDER BY position ASC').all(album.id);
    const allPhotos = db.prepare('SELECT id, url, thumb_url, position, section_id FROM photos WHERE album_id = ? ORDER BY position ASC').all(album.id);
    const sectionsWithPhotos = sections.map(s => ({ ...s, photos: allPhotos.filter(p => p.section_id === s.id) }));
    res.json({
      type: 'album', title: album.title, description: album.description,
      sections: sectionsWithPhotos, photos: allPhotos.filter(p => !p.section_id),
      allowDownload: !!link.allow_download
    });
  } else {
    const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(link.resource_id);
    if (!section) return res.status(404).json({ error: 'Seção não encontrada' });
    const photos = db.prepare('SELECT id, url, thumb_url, position FROM photos WHERE section_id = ? ORDER BY position ASC').all(section.id);
    res.json({ type: 'section', title: section.title, description: section.description, sections: [], photos, allowDownload: !!link.allow_download });
  }
});

// ---------- Upload de fotos pelos convidados (link/QR na festa) ----------
router.post('/:id/guest-upload/toggle', requireAuth, (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(req.params.id);
  if (!album || !(req.user.isAdmin || album.owner_user_id === req.user.userId)) return res.status(403).json({ error: 'Sem acesso' });
  const { enabled } = req.body;
  let token = album.guest_upload_token;
  if (enabled && !token) token = newStorageKey();
  db.prepare('UPDATE albums SET guest_upload_enabled = ?, guest_upload_token = ? WHERE id = ?').run(enabled ? 1 : 0, token, album.id);
  res.json({ ok: true, token: enabled ? token : null });
});

// Página pública de upload dos convidados
router.get('/guest-upload/:token', (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE guest_upload_token = ? AND guest_upload_enabled = 1').get(req.params.token);
  if (!album) return res.status(404).json({ error: 'Link de upload inválido ou desativado' });
  res.json({ id: album.id, title: album.title });
});

router.post('/guest-upload/:token/photos', upload.array('photos', 50), async (req, res) => {
  const album = db.prepare('SELECT * FROM albums WHERE guest_upload_token = ? AND guest_upload_enabled = 1').get(req.params.token);
  if (!album) return res.status(404).json({ error: 'Link de upload inválido ou desativado' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Nenhuma foto enviada' });
  const uploaderName = (req.body.uploaderName || 'Convidado').slice(0, 60);

  // Fotos de convidados sempre entram numa seção própria "Fotos dos convidados"
  let guestSection = db.prepare("SELECT * FROM sections WHERE album_id = ? AND title = 'Fotos dos convidados'").get(album.id);
  if (!guestSection) {
    const position = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM sections WHERE album_id = ?').get(album.id).maxPos + 1;
    const info = db.prepare(`INSERT INTO sections (album_id, title, description, position) VALUES (?, 'Fotos dos convidados', 'Momentos capturados pelos próprios convidados durante a festa', ?)`).run(album.id, position);
    guestSection = db.prepare('SELECT * FROM sections WHERE id = ?').get(info.lastInsertRowid);
  }

  res.json({ ok: true, uploading: files.length });

  let position = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM photos WHERE album_id = ?').get(album.id).maxPos + 1;
  for (const file of files) {
    try {
      const ext = path.extname(file.originalname) || '.jpg';
      const photoKey = `albums/${album.storage_key}/guests/${Date.now()}-${position}${ext}`;
      const thumbKey = `albums/${album.storage_key}/guests/thumbs/${Date.now()}-${position}.jpg`;
      const thumbPath = path.join(os.tmpdir(), `thumb-guest-${Date.now()}-${position}.jpg`);
      await makeThumbnail(file.path, thumbPath);
      const [url, thumbUrl] = await Promise.all([uploadFile(file.path, photoKey), uploadFile(thumbPath, thumbKey)]);

      db.prepare(`
        INSERT INTO photos (album_id, section_id, url, r2_key, thumb_url, original_name, position, source, uploader_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'guest', ?)
      `).run(album.id, guestSection.id, url, photoKey, thumbUrl, file.originalname, position, uploaderName);

      if (!guestSection.cover_url) {
        db.prepare('UPDATE sections SET cover_url = ? WHERE id = ?').run(thumbUrl, guestSection.id);
        guestSection.cover_url = thumbUrl;
      }
      fs.unlink(file.path, () => {});
      fs.unlink(thumbPath, () => {});
      position++;
    } catch (err) {
      console.error('[wedding-flix] Falha ao processar foto de convidado:', err);
      fs.unlink(file.path, () => {});
    }
  }
});

module.exports = router;
