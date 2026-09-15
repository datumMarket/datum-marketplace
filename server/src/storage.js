// File intake: staged upload -> validated, hashed, moved to listing folder.
// Opaque blobs only: we never open, parse, or execute uploaded content.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('./config');
const { httpError } = require('./auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.STAGING_DIR),
  filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}.part`),
});

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE, files: config.MAX_FILES },
});

function extensionOf(filename) {
  const i = filename.lastIndexOf('.');
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase();
}

function sanitizeFilename(name) {
  return path.basename(name).replace(/[^\w.\-]/g, '_').slice(0, 120) || 'file';
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function cleanupStaged(stagedFiles) {
  for (const f of stagedFiles || []) { try { fs.unlinkSync(f.path); } catch {} }
}

// Move staged multer files into uploads/<listingId>/ with index prefix.
async function ingestFiles(stagedFiles, listingId) {
  if (!stagedFiles || stagedFiles.length === 0) throw httpError(400, 'at least one file required');
  const destDir = path.join(config.UPLOADS_DIR, listingId);
  fs.mkdirSync(destDir, { recursive: true });
  const out = [];
  let total = 0;
  try {
    for (let i = 0; i < stagedFiles.length; i++) {
      const f = stagedFiles[i];
      const ext = extensionOf(f.originalname);
      if (!config.ALLOWED_EXTENSIONS.includes(ext)) throw httpError(400, `file type .${ext} not allowed`);
      if (f.size === 0) throw httpError(400, 'empty files not allowed');
      total += f.size;
      if (total > config.MAX_BUNDLE_SIZE) throw httpError(400, 'bundle exceeds max total size');
      const safeName = sanitizeFilename(f.originalname);
      const dest = path.join(destDir, `${i}-${safeName}`);
      fs.renameSync(f.path, dest);
      const sha = await sha256File(dest);
      out.push({ filename: safeName, size: f.size, sha256: sha, position: i, path: dest });
    }
  } catch (err) {
    cleanupStaged(stagedFiles);
    // best-effort rollback of already-moved files
    for (const o of out) { try { fs.unlinkSync(o.path); } catch {} }
    try { fs.rmdirSync(destDir); } catch {}
    throw err;
  }
  return out;
}

// Delete stale staging files left by interrupted/aborted uploads.
function sweepStaging(maxAgeMs = 60 * 60 * 1000) {
  const now = Date.now();
  for (const name of fs.readdirSync(config.STAGING_DIR)) {
    if (!name.endsWith('.part')) continue;
    const p = path.join(config.STAGING_DIR, name);
    try {
      if (now - fs.statSync(p).mtimeMs > maxAgeMs) fs.unlinkSync(p);
    } catch {}
  }
}

module.exports = { upload, ingestFiles, cleanupStaged, sweepStaging, sha256File };
