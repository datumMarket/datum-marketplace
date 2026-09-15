// Listing routes: create (auth+files), browse, detail, sample, update, delist.
const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const { ethers } = require('ethers');
const db = require('../db');
const { requireAuth, httpError } = require('../auth');
const { upload, ingestFiles } = require('../storage');
const driver = require('../storage/driver').getDriver();
const config = require('../config');

const router = express.Router();
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const PRICE_RE = /^(0|[1-9]\d*)(\.\d{1,18})?$/;

function listingFiles(listingId) {
  return db.prepare('SELECT filename, size, sha256, position FROM listing_files WHERE listing_id=? ORDER BY position').all(listingId);
}

function listingJson(row, { withFiles = true } = {}) {
  const out = {
    id: row.id,
    chainListingId: row.chain_listing_id,
    seller: row.seller,
    title: row.title,
    description: row.description,
    priceDtm: ethers.formatUnits(row.price_base_units, config.TOKEN_DECIMALS),
    priceBaseUnits: row.price_base_units,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
  };
  if (withFiles) out.files = listingFiles(row.id);
  return out;
}

function validateMetadata(body) {
  const title = (body.title || '').trim();
  const description = (body.description || '').trim();
  const priceDtm = (body.priceDtm || '').trim();
  if (title.length < 3 || title.length > 200) throw httpError(400, 'title must be 3-200 chars');
  if (description.length < 1 || description.length > 5000) throw httpError(400, 'description must be 1-5000 chars');
  if (!PRICE_RE.test(priceDtm)) throw httpError(400, 'priceDtm must be a positive decimal, max 18 places');
  const baseUnits = ethers.parseUnits(priceDtm, config.TOKEN_DECIMALS);
  if (baseUnits <= 0n) throw httpError(400, 'price must be greater than 0');
  return { title, description, priceBaseUnits: baseUnits.toString() };
}

// Create listing (seller auth + multipart files)
router.post('/listings', requireAuth, upload.array('files', config.MAX_FILES), ah(async (req, res) => {
  const meta = validateMetadata(req.body || {});
  const id = crypto.randomUUID();
  const files = await ingestFiles(req.files, id);
  await driver.finalizeListing(id, files); // zip-at-publish + (r2) upload, before any DB row
  const now = Date.now();
  const tx = db; // node:sqlite is synchronous; do sequential ops
  const nextId = tx.prepare('SELECT COALESCE(MAX(chain_listing_id), 0) + 1 AS n FROM listings').get().n;
  tx.prepare(`INSERT INTO listings (id, chain_listing_id, seller, title, description, price_base_units, status, created_at, updated_at)
              VALUES (?,?,?,?,?,?, 'active', ?, ?)`)
    .run(id, nextId, req.wallet, meta.title, meta.description, meta.priceBaseUnits, now, now);
  const insFile = tx.prepare('INSERT INTO listing_files (id, listing_id, filename, size, sha256, position) VALUES (?,?,?,?,?,?)');
  for (const f of files) insFile.run(crypto.randomUUID(), id, f.filename, f.size, f.sha256, f.position);
  const row = tx.prepare('SELECT * FROM listings WHERE id=?').get(id);
  res.status(201).json(listingJson(row));
}));

// Browse (public)
router.get('/listings', ah(async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const sort = (req.query.sort || 'newest').toString();
  const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
  const where = ["status = 'active'"];
  const params = [];
  if (q) { where.push('(title LIKE ? OR description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
  // length+lexicographic compare (all prices share 18 decimals, so this
  // avoids 64-bit overflow from CAST on values like 1e20)
  const order = {
    newest: 'created_at DESC',
    oldest: 'created_at ASC',
    price_asc: 'length(price_base_units) ASC, price_base_units ASC',
    price_desc: 'length(price_base_units) DESC, price_base_units DESC',
  }[sort] || 'created_at DESC';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM listings WHERE ${where.join(' AND ')}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit);
  // Search logging (A3): record the query and whether it found anything. This is
  // our only instrument for learning the market's shape from outside it, and
  // zero-result queries are its most valuable output. Page 2+ of the same query
  // is the same search, so we log page 1 only.
  if (q && page === 1) {
    db.prepare('INSERT INTO search_log (id, query, result_count, zero_result, source, created_at) VALUES (?,?,?,?,?,?)')
      .run(crypto.randomUUID(), q, total, total === 0 ? 1 : 0, req.get('x-datum-client') || 'rest', Date.now());
  }
  res.json({ total, page, listings: rows.map((r) => listingJson(r, { withFiles: false })) });
}));

function getListingOr404(req) {
  const row = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!row) throw httpError(404, 'listing not found');
  return row;
}

// Detail (public)
router.get('/listings/:id', ah(async (req, res) => {
  res.json(listingJson(getListingOr404(req)));
}));

// Free sample: first ~SAMPLE_BYTES of first file
router.get('/listings/:id/sample', ah(async (req, res) => {
  const listing = getListingOr404(req);
  const file = db.prepare('SELECT * FROM listing_files WHERE listing_id=? ORDER BY position LIMIT 1').get(listing.id);
  if (!file) throw httpError(404, 'no files on this listing');
  const stream = await driver.getFileStream(listing.id, file, { start: 0, end: config.SAMPLE_BYTES - 1 });
  stream.pipe(res);
}));

// Update metadata (seller only; price immutable in v1 — delist + relist to change it)
router.patch('/listings/:id', requireAuth, ah(async (req, res) => {
  const listing = getListingOr404(req);
  if (listing.seller !== req.wallet) throw httpError(403, 'only the seller can update this listing');
  const body = req.body || {};
  const title = (body.title ?? listing.title).trim();
  const description = (body.description ?? listing.description).trim();
  if (title.length < 3 || title.length > 200) throw httpError(400, 'title must be 3-200 chars');
  if (description.length < 1 || description.length > 5000) throw httpError(400, 'description must be 1-5000 chars');
  if (body.priceDtm !== undefined && ethers.formatUnits(listing.price_base_units, config.TOKEN_DECIMALS) !== (body.priceDtm || '').trim())
    throw httpError(400, 'price is immutable in v1; delist and relist to change it');
  db.prepare('UPDATE listings SET title=?, description=?, updated_at=? WHERE id=?')
    .run(title, description, Date.now(), listing.id);
  res.json(listingJson(db.prepare('SELECT * FROM listings WHERE id=?').get(listing.id)));
}));

// Delist (seller only; past buyers keep download access)
router.delete('/listings/:id', requireAuth, ah(async (req, res) => {
  const listing = getListingOr404(req);
  if (listing.seller !== req.wallet) throw httpError(403, 'only the seller can delist this listing');
  db.prepare("UPDATE listings SET status='delisted', updated_at=? WHERE id=?").run(Date.now(), listing.id);
  res.json({ ok: true, status: 'delisted' });
}));

module.exports = router;
