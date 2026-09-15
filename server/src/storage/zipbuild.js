// Build a zip bundle from ingested file records. Shared by both drivers.
const fs = require('fs');
const archiver = require('archiver');

// files: [{ path, filename }] — zips in order given, waits for flush.
function buildZipTo(files, outPath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    out.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(out);
    for (const f of files) archive.file(f.path, { name: f.filename });
    archive.finalize();
  });
}

module.exports = { buildZipTo };
