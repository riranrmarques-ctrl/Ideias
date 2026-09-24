const TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

module.exports = function mime(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return TYPES[ext] || 'application/octet-stream';
};
