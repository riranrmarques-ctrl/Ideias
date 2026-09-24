const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { db, newStorageKey } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { transcodeToHLS } = require('../utils/hls');
const { uploadDir, uploadFile, deletePrefix } = require('../utils/r2');

const router = express.Router();

const upload = multer({ dest: path.join(os.tmpdir(), 'wedding-flix-uploads') });

const PUBLIC_COLUMNS = `id, title, description, category, poster_url, hls_url, status, duration_seconds, max_quality, orientation, owner_user_id, created_at`;

// Portfólio público — sem login, só o que está marcado como público (owner_user_id = NULL)
router.get('/portfolio', (req, res) => {
  const videos = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM videos WHERE owner_user_id IS NULL ORDER BY created_at DESC`).all();
  res.json(videos);
});

// "Minha área" — exige login. Cliente vê só o que é dele; admin vê tudo.
router.get('/', requireAuth, (req, res) => {
  let videos;
  if (req.user.isAdmin) {
    videos = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM videos ORDER BY created_at DESC`).all();
  } else {
    videos = db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM videos WHERE owner_user_id = ? ORDER BY created_at DESC`).all(req.user.userId);
  }
  res.json(videos);
});

router.get('/:id', require('../middleware/auth').optionalAuth, (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Vídeo não encontrado' });
  const isPublic = video.owner_user_id === null;
  const isOwner = req.user && video.owner_user_id === req.user.userId;
  const isAdmin = req.user?.isAdmin;
  if (!isPublic && !isOwner && !isAdmin) return res.status(403).json({ error: 'Faça login pra ver este vídeo' });
  res.json(video);
});

// Admin: cadastra metadados + envia o vídeo original para processamento.
// ownerUserId vazio/ausente = conteúdo público do portfólio.
router.post('/', requireAdmin, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'poster', maxCount: 1 }]), async (req, res) => {
  const { title, description, category, ownerUserId } = req.body;
  const videoFile = req.files?.video?.[0];
  const posterFile = req.files?.poster?.[0];

  if (!title || !videoFile) {
    return res.status(400).json({ error: 'Título e arquivo de vídeo são obrigatórios' });
  }

  const storageKey = newStorageKey();

  let posterUrl = '';
  if (posterFile) {
    const ext = path.extname(posterFile.originalname) || '.jpg';
    posterUrl = await uploadFile(posterFile.path, `videos/${storageKey}/poster${ext}`);
    fs.unlink(posterFile.path, () => {});
  }

  const info = db.prepare(`
    INSERT INTO videos (storage_key, title, description, category, poster_url, status, owner_user_id)
    VALUES (?, ?, ?, ?, ?, 'processing', ?)
  `).run(storageKey, title, description || '', category || 'Casamentos', posterUrl, ownerUserId ? Number(ownerUserId) : null);

  const videoId = info.lastInsertRowid;
  res.json({ ok: true, id: videoId, status: 'processing' });

  processVideoAsync(videoId, storageKey, videoFile.path).catch(err => {
    console.error(`[wedding-flix] Falha ao processar vídeo ${videoId}:`, err);
    db.prepare('UPDATE videos SET status = ? WHERE id = ?').run('error', videoId);
  });
});

async function processVideoAsync(videoId, storageKey, inputPath) {
  const workDir = path.join(os.tmpdir(), `wedding-flix-hls-${storageKey}`);
  try {
    const result = await transcodeToHLS(inputPath, workDir, {
      onProgress: (pct) => {
        db.prepare('UPDATE videos SET status = ? WHERE id = ?').run(`processing:${pct}%`, videoId);
      }
    });

    const remotePrefix = `videos/${storageKey}`;
    await uploadDir(workDir, remotePrefix);

    const hlsUrl = `${process.env.R2_PUBLIC_URL.replace(/\/$/, '')}/${remotePrefix}/master.m3u8`;
    const maxQuality = result.rungs[result.rungs.length - 1];

    db.prepare(`
      UPDATE videos SET status = 'ready', hls_url = ?, duration_seconds = ?, max_quality = ?, orientation = ? WHERE id = ?
    `).run(hlsUrl, result.duration, maxQuality, result.orientation, videoId);

    console.log(`[wedding-flix] Vídeo ${videoId} pronto (${result.orientation}, ${maxQuality}, ${result.duration}s)`);
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
    fs.unlink(inputPath, () => {});
  }
}

router.patch('/:id', requireAdmin, (req, res) => {
  const { title, description, category, ownerUserId } = req.body;
  db.prepare(`
    UPDATE videos SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      category = COALESCE(?, category),
      owner_user_id = ?
    WHERE id = ?
  `).run(title, description, category, ownerUserId ? Number(ownerUserId) : null, req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id);
  if (!video) return res.status(404).json({ error: 'Não encontrado' });
  await deletePrefix(`videos/${video.storage_key}`).catch(() => {});
  db.prepare('DELETE FROM videos WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
