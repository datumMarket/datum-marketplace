// Storage driver seam (Stage 4a): filesystem (default) | r2.
// Selected by STORAGE_DRIVER env. No R2 env -> filesystem. Fail-safe by
// construction; rollback = flip the flag (docs/DEPLOYMENT.md).
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { buildZipTo } = require('./zipbuild');

function storedPath(listingId, file) {
  return path.join(config.UPLOADS_DIR, listingId, `${file.position}-${file.filename}`);
}
function bundlePath(listingId) {
  return path.join(config.UPLOADS_DIR, listingId, 'bundle.zip');
}

const filesystem = {
  kind: 'filesystem',
  // Zip built once at listing time; downloads stream the prebuilt bundle.
  finalizeListing: (listingId, files) => buildZipTo(files, bundlePath(listingId)),
  getFileStream: (listingId, file, range) =>
    fs.createReadStream(storedPath(listingId, file), range ? { start: range.start, end: range.end } : {}),
  presignBundle: async () => null,
  presignFile: async () => null,
};

let cached = null;
function getDriver() {
  if (cached) return cached;
  if ((config.STORAGE_DRIVER || 'filesystem') === 'r2') {
    const missing = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((k) => !config[k]);
    if (missing.length) throw new Error(`STORAGE_DRIVER=r2 but missing env: ${missing.join(', ')}`);
    cached = require('./r2').createR2Driver(config);
  } else {
    cached = filesystem;
  }
  return cached;
}

module.exports = { getDriver, storedPath, bundlePath };
