const { S3Client, PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs');
const path = require('path');
const mime = require('./mime');

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

// Sobe um único arquivo
async function uploadFile(localPath, key) {
  const fileStream = fs.createReadStream(localPath);
  const contentType = mime(key);
  const uploader = new Upload({
    client: r2,
    params: { Bucket: BUCKET, Key: key, Body: fileStream, ContentType: contentType }
  });
  await uploader.done();
  return `${PUBLIC_URL}/${key}`;
}

// Sobe todos os arquivos de uma pasta local (usado para os segmentos HLS), mantendo a estrutura
async function uploadDir(localDir, remotePrefix) {
  const entries = fs.readdirSync(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remoteKey = `${remotePrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      await uploadDir(localPath, remoteKey);
    } else {
      await uploadFile(localPath, remoteKey);
    }
  }
}

// Remove tudo dentro de um prefixo (usado ao excluir um vídeo)
async function deletePrefix(prefix) {
  let continuationToken;
  do {
    const list = await r2.send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: prefix, ContinuationToken: continuationToken
    }));
    if (list.Contents && list.Contents.length) {
      await r2.send(new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: list.Contents.map(o => ({ Key: o.Key })) }
      }));
    }
    continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (continuationToken);
}

// Lê um objeto do bucket como stream (usado pra download de fotos e zip de álbum)
async function getObjectStream(key) {
  const result = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return { stream: result.Body, contentType: result.ContentType, contentLength: result.ContentLength };
}

module.exports = { uploadFile, uploadDir, deletePrefix, getObjectStream, PUBLIC_URL };
