// R2 driver (Stage 4a): all file bytes live in Cloudflare R2 (S3-compatible).
// Private bucket; buyers reach bytes only via short-lived presigned URLs that
// the API issues AFTER on-chain purchase verification (routes/download.js).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { buildZipTo } = require('./zipbuild');

function createR2Driver(cfg) {
  const endpoint = cfg.R2_ENDPOINT || `https://${cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const client = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId: cfg.R2_ACCESS_KEY_ID, secretAccessKey: cfg.R2_SECRET_ACCESS_KEY },
  });
  const bucket = cfg.R2_BUCKET || 'datum-uploads';
  const presignTtl = cfg.R2_PRESIGN_TTL_SEC || 900;
  const key = (listingId, suffix) => `listings/${listingId}/${suffix}`;

  async function putLocalFile(localPath, k) {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: k, Body: fs.createReadStream(localPath) }));
  }

  return {
    kind: 'r2',
    // Zip built ONCE at listing time (spec §11). Individual files uploaded
    // too (sample + single-file downloads). Local copies removed after a
    // successful upload so no bytes live on the API box.
    async finalizeListing(listingId, files) {
      for (const f of files) await putLocalFile(f.path, key(listingId, `${f.position}-${f.filename}`));
      const tmpZip = path.join(os.tmpdir(), `datum-bundle-${listingId}.zip`);
      try {
        await buildZipTo(files, tmpZip);
        await putLocalFile(tmpZip, key(listingId, 'bundle.zip'));
      } finally {
        try { fs.unlinkSync(tmpZip); } catch {}
      }
      try { fs.rmSync(path.join(cfg.UPLOADS_DIR, listingId), { recursive: true, force: true }); } catch {}
    },
    async getFileStream(listingId, file, range) {
      const res = await client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key(listingId, `${file.position}-${file.filename}`),
        ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
      }));
      return res.Body;
    },
    presignBundle: (listingId) => getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key(listingId, 'bundle.zip') }), { expiresIn: presignTtl }),
    presignFile: (listingId, file) => getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key(listingId, `${file.position}-${file.filename}`) }), { expiresIn: presignTtl }),
  };
}

module.exports = { createR2Driver };
