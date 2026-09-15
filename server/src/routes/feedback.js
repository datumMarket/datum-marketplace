// Agent feedback: public submit (rate-limited) + authenticated read for admins.
// This is the "report a problem / reach out" channel advertised in /health.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, httpError } = require('../auth');
const config = require('../config');

const router = express.Router();
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const TOPICS = ['bug', 'question', 'feature', 'payment', 'listing', 'other'];
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_MAX = 20; // submissions per IP per hour
const MAX_CONTEXT_CHARS = 4000;

function serialize(row) {
  let context = null;
  if (row.context) {
    try { context = JSON.parse(row.context); } catch { context = row.context; }
  }
  return {
    id: row.id,
    wallet: row.wallet || null,
    topic: row.topic,
    message: row.message,
    context,
    chainId: row.chain_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// Submit feedback (public; no auth required — agents may be blocked before login).
router.post('/feedback', ah(async (req, res) => {
  const body = req.body || {};
  const topic = (body.topic || 'other').toString().trim().toLowerCase();
  const message = (body.message || '').toString().trim();
  const walletRaw = (body.wallet || '').toString().trim().toLowerCase();
  const wallet = walletRaw || null;
  const ip = req.ip || null;

  if (!TOPICS.includes(topic)) throw httpError(400, `topic must be one of: ${TOPICS.join(', ')}`);
  if (message.length < 5 || message.length > 4000) throw httpError(400, 'message must be 5-4000 chars');
  if (wallet && !/^0x[0-9a-f]{40}$/.test(wallet)) throw httpError(400, 'wallet must be a 0x-prefixed address');

  const since = Date.now() - RATE_WINDOW_MS;
  const recent = db.prepare('SELECT COUNT(*) AS c FROM feedback WHERE ip=? AND created_at>=?').get(ip, since).c;
  if (recent >= RATE_MAX) throw httpError(429, 'rate limit exceeded: too many submissions this hour');

  let context = null;
  if (body.context != null) {
    const s = typeof body.context === 'string' ? body.context : JSON.stringify(body.context);
    if (s.length > MAX_CONTEXT_CHARS) throw httpError(400, `context too large (max ${MAX_CONTEXT_CHARS} chars)`);
    context = s;
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`INSERT INTO feedback (id, wallet, ip, topic, message, context, chain_id, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, wallet, ip, topic, message, context, config.CHAIN_ID, now);

  res.status(201).json({
    ok: true,
    id,
    receivedAt: new Date(now).toISOString(),
    topic,
    contact: config.CONTACT_EMAIL,
    note: 'Received. A human reads these.',
  });
}));

// Read feedback (admins only — wallets listed in ADMIN_WALLETS).
router.get('/feedback', requireAuth, ah(async (req, res) => {
  if (!config.ADMIN_WALLETS.includes(req.wallet)) throw httpError(403, 'not authorized');
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
  const rows = db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json({ count: rows.length, feedback: rows.map(serialize) });
}));

module.exports = router;
