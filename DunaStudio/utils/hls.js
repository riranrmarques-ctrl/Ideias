const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Detecta resolução e duração do vídeo original usando ffprobe
function probe(inputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      inputPath
    ];
    const proc = spawn('ffprobe', args);
    let out = '';
    let err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('ffprobe falhou: ' + err));
      try {
        const data = JSON.parse(out);
        const stream = data.streams?.[0] || {};
        const width = stream.width || 1920;
        const height = stream.height || 1080;
        resolve({
          width,
          height,
          orientation: height > width ? 'vertical' : 'horizontal',
          duration: Math.round(parseFloat(data.format?.duration || 0))
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Escada de qualidades: mínimo 1080p (no lado curto), sobe até 4K conforme o original.
// "height" aqui representa o lado curto do vídeo — funciona tanto pra
// horizontal (1920x1080) quanto pra vertical (1080x1920).
const LADDER = [
  { name: '1080p', height: 1080, videoBitrate: '8000k', maxrate: '8560k', bufsize: '12000k', audioBitrate: '192k' },
  { name: '1440p', height: 1440, videoBitrate: '12000k', maxrate: '12840k', bufsize: '18000k', audioBitrate: '192k' },
  { name: '2160p', height: 2160, videoBitrate: '20000k', maxrate: '21400k', bufsize: '30000k', audioBitrate: '192k' }
];

function buildLadder(sourceShortSide) {
  // Sempre inclui 1080p como piso; inclui as camadas superiores só se o original suportar
  const rungs = LADDER.filter(r => r.height <= sourceShortSide || r.height === 1080);
  return rungs;
}

// Roda o ffmpeg gerando todas as variantes + master playlist em outputDir
function transcodeToHLS(inputPath, outputDir, { onProgress } = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const info = await probe(inputPath);
      const isVertical = info.orientation === 'vertical';
      const sourceShortSide = Math.min(info.width, info.height);
      const rungs = buildLadder(sourceShortSide);
      fs.mkdirSync(outputDir, { recursive: true });

      const args = ['-y', '-i', inputPath];
      const filterParts = [];
      const varStreamMaps = [];

      rungs.forEach((r, i) => {
        // Horizontal: escala pela altura (largura automática, par).
        // Vertical: escala pela largura (altura automática, par) — o "lado curto" é a largura.
        const scale = isVertical ? `scale=${r.height}:-2` : `scale=-2:${r.height}`;
        filterParts.push(`[0:v]${scale}[v${i}]`);
      });
      args.push('-filter_complex', filterParts.join(';'));

      rungs.forEach((r, i) => {
        args.push(
          '-map', `[v${i}]`, '-map', '0:a:0?',
          `-c:v:${i}`, 'libx264', `-b:v:${i}`, r.videoBitrate,
          `-maxrate:v:${i}`, r.maxrate, `-bufsize:v:${i}`, r.bufsize,
          `-preset`, 'veryfast', `-g`, '48', `-sc_threshold`, '0',
          `-c:a:${i}`, 'aac', `-b:a:${i}`, r.audioBitrate, '-ac', '2'
        );
        varStreamMaps.push(`v:${i},a:${i},name:${r.name}`);
      });

      args.push(
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_playlist_type', 'vod',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(outputDir, '%v', 'seg_%03d.ts'),
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', varStreamMaps.join(' '),
        path.join(outputDir, '%v', 'playlist.m3u8')
      );

      // cria subpastas antes do ffmpeg escrever nelas
      rungs.forEach(r => fs.mkdirSync(path.join(outputDir, r.name), { recursive: true }));

      const proc = spawn('ffmpeg', args);
      let stderr = '';
      proc.stderr.on('data', d => {
        stderr += d;
        const match = d.toString().match(/time=(\d+):(\d+):(\d+\.\d+)/);
        if (match && onProgress && info.duration) {
          const seconds = (+match[1]) * 3600 + (+match[2]) * 60 + parseFloat(match[3]);
          onProgress(Math.min(99, Math.round((seconds / info.duration) * 100)));
        }
      });
      proc.on('close', code => {
        if (code !== 0) return reject(new Error('ffmpeg falhou: ' + stderr.slice(-2000)));
        resolve({
          rungs: rungs.map(r => r.name),
          duration: info.duration,
          orientation: info.orientation,
          sourceWidth: info.width,
          sourceHeight: info.height
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { transcodeToHLS, probe };
