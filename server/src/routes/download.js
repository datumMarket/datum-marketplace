// Download routes: HMAC-token gated bundle (zip) or single file.
// Filesystem driver: server streams bytes. R2 driver: 302 to a short-lived
// presigned URL — purchase verification still happens HERE before the redirect.
const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../db');
const { httpError } = require('../auth');
const tokens = require('../downloadTokens');
const config = require('../config');
const { getDriver, storedPath, bundlePath } = require('../storage/driver');

const router = express.Router();
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const driver = getDriver(); // loud at boot if r2 is misconfigured

// Authorization is about OWNERSHIP, not purchase: you may download a listing if
// you bought it, or if you created it. Both sides are compared against rows read
// from the database — never against anything supplied in the request. The token
// is a bearer credential, so all the security lives in who can mint one, and
// minting happens behind requireAuth (a wallet signature).
function authorize(req) {
  const payload = tokens.verify(req.params.token);
  if (!payload) throw httpError(403, 'invalid or expired download token');
  const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(payload.listingId);
  if (!listing) throw httpError(404, 'listing not found');
  const wallet = String(payload.wallet).toLowerCase();
  const buyers = db.prepare('SELECT buyer FROM purchases WHERE listing_id=?').all(payload.listingId);
  const isBuyer = buyers.some((b) => String(b.buyer).toLowerCase() === wallet);
  const isSeller = String(listing.seller).toLowerCase() === wallet;
  if (!isBuyer && !isSeller) throw httpError(403, 'no purchase found for this buyer and listing');
  return payload;
}

function zipHeaders(res, listing) {
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="datum-listing-${listing.chain_listing_id}.zip"`);
}

// Full bundle as zip
router.get('/download/:token', ah(async (req, res) => {
  const { listingId } = authorize(req);
  const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
  if (!listing) throw httpError(404, 'listing not found');
  const presigned = await driver.presignBundle(listingId);
  if (presigned) return res.redirect(presigned);
  // Filesystem: stream the zip built at listing time (fallback: build on the
  // fly for listings created before bundle-at-publish existed).
  if (fs.existsSync(bundlePath(listingId))) {
    zipHeaders(res, listing);
    return fs.createReadStream(bundlePath(listingId)).pipe(res);
  }
  const files = db.prepare('SELECT * FROM listing_files WHERE listing_id=? ORDER BY position').all(listingId);
  if (files.length === 0) throw httpError(404, 'listing files not found');
  zipHeaders(res, listing);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', () => { try { res.end(); } catch {} });
  archive.pipe(res);
  for (const f of files) {
    const p = storedPath(listingId, f);
    if (fs.existsSync(p)) archive.file(p, { name: f.filename });
  }
  archive.finalize();
}));

// Single file from the bundle
router.get('/download/:token/files/:filename', ah(async (req, res) => {
  const { listingId } = authorize(req);
  const file = db
    .prepare('SELECT * FROM listing_files WHERE listing_id=? AND filename=?')
    .get(listingId, req.params.filename);
  if (!file) throw httpError(404, 'file not found in this listing');
  const presigned = await driver.presignFile(listingId, file);
  if (presigned) return res.redirect(presigned);
  const p = storedPath(listingId, file);
  if (!fs.existsSync(p)) throw httpError(410, 'file no longer stored');
  res.set('Content-Type', 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
  fs.createReadStream(p).pipe(res);
}));

module.exports = router;
