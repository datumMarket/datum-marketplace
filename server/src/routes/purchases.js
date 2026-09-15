// Purchase routes: quote, confirm (verify on-chain), buyer history.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, httpError } = require('../auth');
const chain = require('../chain');
const tokens = require('../downloadTokens');
const config = require('../config');

const router = express.Router();
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function getListingOr404(req) {
  const row = db.prepare('SELECT * FROM listings WHERE id=?').get(req.params.id);
  if (!row) throw httpError(404, 'listing not found');
  return row;
}

// Quote: everything a buyer agent needs to build the purchase tx (public)
router.get('/listings/:id/quote', ah(async (req, res) => {
  const listing = getListingOr404(req);
  if (listing.status !== 'active') throw httpError(410, 'listing is delisted');
  res.json(chain.quote(listing));
}));

// Confirm: verify the on-chain Purchase event, record, return download URL
router.post('/purchases/confirm', ah(async (req, res) => {
  const { listingId, txHash } = req.body || {};
  if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw httpError(400, 'invalid txHash');
  const listing = db.prepare('SELECT * FROM listings WHERE id=?').get(listingId);
  if (!listing) throw httpError(404, 'listing not found');
  const verified = await chain.verifyPurchaseTx(txHash.toLowerCase(), listing);
  const existing = db.prepare('SELECT * FROM purchases WHERE tx_hash=?').get(txHash.toLowerCase());
  let purchase = existing;
  if (!purchase) {
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO purchases (id, listing_id, chain_listing_id, buyer, amount_base_units, fee_base_units, tx_hash, block_number, created_at)
                VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(id, listing.id, listing.chain_listing_id, verified.buyer, verified.amount, verified.fee, txHash.toLowerCase(), verified.blockNumber, Date.now());
    purchase = db.prepare('SELECT * FROM purchases WHERE id=?').get(id);
  }
  res.json({
    purchase: {
      listingId: purchase.listing_id,
      buyer: purchase.buyer,
      amountBaseUnits: purchase.amount_base_units,
      txHash: purchase.tx_hash,
      blockNumber: purchase.block_number,
    },
    downloadUrl: `/download/${tokens.issue(purchase.listing_id, purchase.buyer)}`,
    downloadUrlExpiresInMinutes: Math.round(config.DOWNLOAD_URL_TTL_MS / 60000),
  });
}));

// Buyer's purchase history with fresh download URLs (auth)
router.get('/purchases/mine', requireAuth, ah(async (req, res) => {
  const rows = db.prepare('SELECT * FROM purchases WHERE buyer=? ORDER BY created_at DESC LIMIT 100').all(req.wallet);
  res.json({
    purchases: rows.map((p) => ({
      listingId: p.listing_id,
      amountBaseUnits: p.amount_base_units,
      txHash: p.tx_hash,
      blockNumber: p.block_number,
      purchasedAt: new Date(p.created_at).toISOString(),
      downloadUrl: `/download/${tokens.issue(p.listing_id, p.buyer)}`,
    })),
  });
}));

module.exports = router;
