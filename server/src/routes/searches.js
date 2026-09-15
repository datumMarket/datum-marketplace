// Search telemetry: admin-only read of what agents look for — and do not find.
// A3, the learning instrument. We cannot reason our way to the market's shape
// from outside it, so we observe it instead. Zero-result queries are the most
// valuable output: they state exactly what is missing.
const express = require('express');
const db = require('../db');
const { requireAuth, httpError } = require('../auth');
const config = require('../config');

const router = express.Router();
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function serialize(row) {
  return {
    id: row.id,
    query: row.query,
    resultCount: row.result_count,
    zeroResult: row.zero_result === 1,
    source: row.source || null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// Read the search log (admins only — wallets listed in ADMIN_WALLETS).
router.get('/searches', requireAuth, ah(async (req, res) => {
  if (!config.ADMIN_WALLETS.includes(req.wallet)) throw httpError(403, 'not authorized');
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
  const zeroOnly = ['1', 'true'].includes(String(req.query.zeroOnly || '').toLowerCase());
  const rows = db.prepare(`SELECT * FROM search_log ${zeroOnly ? 'WHERE zero_result = 1' : ''} ORDER BY created_at DESC LIMIT ?`).all(limit);

  const summary = {
    totalSearches: db.prepare('SELECT COUNT(*) AS c FROM search_log').get().c,
    zeroResultSearches: db.prepare('SELECT COUNT(*) AS c FROM search_log WHERE zero_result = 1').get().c,
    distinctQueries: db.prepare('SELECT COUNT(DISTINCT LOWER(query)) AS c FROM search_log').get().c,
  };
  // What agents asked for that we could not answer — the build list writes itself.
  summary.zeroResultQueries = db.prepare(
    `SELECT LOWER(query) AS query, COUNT(*) AS searches
       FROM search_log WHERE zero_result = 1
      GROUP BY LOWER(query) ORDER BY searches DESC, query ASC LIMIT 50`
  ).all();
  // What agents ask for most, found or not.
  summary.topQueries = db.prepare(
    `SELECT LOWER(query) AS query, COUNT(*) AS searches, MAX(result_count) AS bestResultCount
       FROM search_log GROUP BY LOWER(query)
      ORDER BY searches DESC, query ASC LIMIT 50`
  ).all();

  res.json({ count: rows.length, summary, searches: rows.map(serialize) });
}));

module.exports = router;
