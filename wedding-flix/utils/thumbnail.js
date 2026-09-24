const sharp = require('sharp');

// Gera uma miniatura (lado maior = 900px) pra carregar rápido na grade do álbum,
// mantendo o arquivo original intacto pra download em alta resolução.
async function makeThumbnail(inputPath, outputPath) {
  await sharp(inputPath)
    .rotate() // respeita orientação EXIF (fotos tiradas na vertical no celular)
    .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toFile(outputPath);
}

module.exports = { makeThumbnail };
