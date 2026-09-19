// Request board routes ("ISO"): agents post data they need, sellers attach
// listing offers, requester closes when fulfilled or cancelled.
// Additive v1: no offers editing, no notifications — agents poll.
const express = require('express');
const crypto = require('crypto');
const { ethers } = require('ethers');
const db = require('../db');
const { requireAuth, httpError } = require('../auth');
const config = require('../config');
const { buildSearch } = require('../search');

const router = express.Router();
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const PRICE_RE = /^(0|[1-9]\d*)(\.\d{1,18})?$/;
const STATUSES = new Set(['open', 'fulfilled', 'cancelled']);

function offersFor(requestId) {
  return db.prepare(`
    SELECT o.id AS offer_id, o.created_at AS offered_at, l.id AS listing_id, l.seller, l.title, l.description, l.price_base_units, l.status AS listing_status
    FROM request_offers o JOIN listings l ON l.id = o.listing_id
    WHERE o.request_id = ? ORDER BY o.created_at ASC`).all(requestId)
    .map((r) => ({
      offerId: r.offer_id,
      listingId: r.listing_id,
      seller: r.seller,
      title: r.title,
      description: r.description,
      priceDtm: ethers.formatUnits(r.price_base_units, config.TOKEN_DECIMALS),
      listingStatus: r.listing_status,
      offeredAt: new Date(r.offered_at).toISOString(),
    }));
}

function requestJson(row, { withOffers = false } = {}) {
  const out = {
    id: row.id,
    requester: row.requester,
    title: row.title,
    description: row.description,
    maxPriceDtm: row.max_price_base_units ? ethers.formatUnits(row.max_price_base_units, config.TOKEN_DECIMALS) : null,
    maxPriceBaseUnits: row.max_price_base_units,
    status: row.status,
    offerCount: db.prepare('SELECT COUNT(*) AS c FROM request_offers WHERE request_id=?').get(row.id).c,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
  if (withOffers) out.offers = offersFor(row.id);
  return out;
}

function validateRequestBody(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.title !== undefined) {
    const title = (body.title || '').trim();
    if (title.length < 3 || title.length > 200) throw httpError(400, 'title must be 3-200 chars');
    out.title = title;
  }
  if (!partial || body.description !== undefined) {
    const description = (body.description || '').trim();
    if (description.length < 1 || description.length > 5000) throw httpError(400, 'description must be 1-5000 chars');
    out.description = description;
  }
  if (body.maxPriceDtm !== undefined) {
    const mp = String(body.maxPriceDtm).trim();
    if (mp === '') out.maxPriceBaseUnits = null;
    else {
      if (!PRICE_RE.test(mp)) throw httpError(400, 'maxPriceDtm must be a non-negative decimal, max 18 places');
      out.maxPriceBaseUnits = ethers.parseUnits(mp, config.TOKEN_DECIMALS).toString();
    }
  }
  return out;
}

// Create request (auth; per-wallet open cap as spam control)
router.post('/requests', requireAuth, ah(async (req, res) => {
  const fields = validateRequestBody(req.body || {});
  const open = db.prepare("SELECT COUNT(*) AS c FROM requests WHERE requester=? AND status='open'").get(req.wallet).c;
  if (open >= config.MAX_OPEN_REQUESTS_PER_WALLET)
    throw httpError(429, `open request cap reached (${config.MAX_OPEN_REQUESTS_PER_WALLET}) — close some first`);
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO requests (id, requester, title, description, max_price_base_units, status, created_at, updated_at)
              VALUES (?,?,?,?,?,'open',?,?)`)
    .run(id, req.wallet, fields.title, fields.description, fields.maxPriceBaseUnits ?? null, now, now);
  res.status(201).json(requestJson(db.prepare('SELECT * FROM requests WHERE id=?').get(id), { withOffers: true }));
}));

// Browse (public). Default board = open requests only.
router.get('/requests', ah(async (req, res) => {
  const q = (req.query.q || '').toString().trim();
  const status = (req.query.status || 'open').toString();
  const requester = (req.query.requester || '').toString().trim().toLowerCase();
  const sort = (req.query.sort || 'newest').toString();
  const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
  const where = [];
  const params = [];
  if (status !== 'all') {
    if (!STATUSES.has(status)) throw httpError(400, 'status must be open|fulfilled|cancelled|all');
    where.push('status = ?');
    params.push(status);
  }
  const search = buildSearch(q, ['title', 'description']);
  if (search) {
    if (search.noMatch) where.push('1=0');
    else { where.push(search.whereSql); params.push(...search.whereParams); }
  }
  if (requester) { where.push('requester = ?'); params.push(requester); }
  const cond = where.length ? where.join(' AND ') : '1=1';
  const order = { newest: 'created_at DESC', oldest: 'created_at ASC' }[sort] || 'created_at DESC';
  const relevance = search && !search.noMatch ? `${search.scoreSql} DESC, ` : '';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM requests WHERE ${cond}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM requests WHERE ${cond} ORDER BY ${relevance}${order} LIMIT ? OFFSET ?`)
    .all(...params, ...(search && !search.noMatch ? search.scoreParams : []), limit, (page - 1) * limit);
  res.json({ total, page, requests: rows.map((r) => requestJson(r)) });
}));

// Detail with offers (public)
router.get('/requests/:id', ah(async (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
  if (!row) throw httpError(404, 'request not found');
  res.json(requestJson(row, { withOffers: true }));
}));

// Edit metadata or close (requester only; open only)
router.patch('/requests/:id', requireAuth, ah(async (req, res) => {
  const row = db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
  if (!row) throw httpError(404, 'request not found');
  if (row.requester !== req.wallet) throw httpError(403, 'only the requester can modify this request');
  if (row.status !== 'open') throw httpError(409, 'request is closed');
  const body = req.body || {};
  const fields = validateRequestBody(body, { partial: true });
  let status = row.status;
  if (body.status !== undefined) {
    if (!['fulfilled', 'cancelled'].includes(body.status)) throw httpError(400, 'status must be fulfilled|cancelled');
    status = body.status;
  }
  db.prepare('UPDATE requests SET title=?, description=?, max_price_base_units=?, status=?, updated_at=? WHERE id=?')
    .run(fields.title ?? row.title,
         fields.description ?? row.description,
         fields.maxPriceBaseUnits !== undefined ? fields.maxPriceBaseUnits : row.max_price_base_units,
         status, Date.now(), row.id);
  res.json(requestJson(db.prepare('SELECT * FROM requests WHERE id=?').get(row.id), { withOffers: true }));
}));

// Attach a listing offer (seller auth; own active listings only)
router.post('/requests/:id/offers', requireAuth, ah(async (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id=?').get(req.params.id);
  if (!request) throw httpError(404, 'request not found');
  if (request.status !== 'open') throw httpError(409, 'request is closed');
  if (request.requester === req.wallet) throw httpError(400, 'cannot offer on your own request');
  const listingId = (req.body || {}).listingId;
  if (typeof listingId !== 'string' || !listingId) throw httpError(400, 'listingId is required');
  const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
  if (!listing) throw httpError(404, 'listing not found');
  if (listing.seller !== req.wallet) throw httpError(403, 'you can only offer your own listings');
  if (listing.status !== 'active') throw httpError(400, 'listing is delisted');
  if (db.prepare('SELECT id FROM request_offers WHERE request_id=? AND listing_id=?').get(request.id, listing.id))
    throw httpError(409, 'this listing is already offered on this request');
  const offerCount = db.prepare('SELECT COUNT(*) AS c FROM request_offers WHERE request_id=?').get(request.id).c;
  if (offerCount >= config.MAX_OFFERS_PER_REQUEST) throw httpError(429, `offer cap reached (${config.MAX_OFFERS_PER_REQUEST})`);
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO request_offers (id, request_id, listing_id, seller, created_at) VALUES (?,?,?,?,?)')
    .run(id, request.id, listing.id, req.wallet, Date.now());
  res.status(201).json({
    ok: true,
    offerId: id,
    requestId: request.id,
    listing: {
      id: listing.id,
      title: listing.title,
      priceDtm: ethers.formatUnits(listing.price_base_units, config.TOKEN_DECIMALS),
      seller: listing.seller,
    },
  });
}));

module.exports = router;
