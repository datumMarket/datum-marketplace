// SIWE-lite wallet auth: challenge message -> personal_sign -> bearer token.
const crypto = require('crypto');
const { ethers } = require('ethers');
const db = require('./db');
const config = require('./config');

function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

function buildMessage(wallet, nonce) {
  const now = Date.now();
  return {
    message: [
      'Datum Marketplace Login',
      'URI: datum.market',
      `Wallet: ${wallet}`,
      `Nonce: ${nonce}`,
      `Issued At: ${new Date(now).toISOString()}`,
      `Expires At: ${new Date(now + config.CHALLENGE_TTL_MS).toISOString()}`,
    ].join('\n'),
    expiresAt: now + config.CHALLENGE_TTL_MS,
  };
}

function createChallenge(wallet) {
  wallet = (wallet || '').toLowerCase();
  if (!ethers.isAddress(wallet)) throw httpError(400, 'invalid wallet address');
  const nonce = crypto.randomBytes(16).toString('hex');
  const { message, expiresAt } = buildMessage(wallet, nonce);
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO challenges (id, wallet, message, expires_at) VALUES (?,?,?,?)')
    .run(id, wallet, message, expiresAt);
  return { challengeId: id, message };
}

function verifyChallenge(wallet, message, signature) {
  wallet = (wallet || '').toLowerCase();
  let recovered;
  try {
    recovered = ethers.verifyMessage(message || '', signature || '').toLowerCase();
  } catch {
    throw httpError(401, 'invalid signature');
  }
  if (recovered !== wallet) throw httpError(401, 'signature does not match wallet');
  const row = db.prepare('SELECT * FROM challenges WHERE wallet=? AND message=?').get(wallet, message);
  if (!row) throw httpError(401, 'unknown challenge');
  if (row.used) throw httpError(401, 'challenge already used');
  if (row.expires_at < Date.now()) throw httpError(401, 'challenge expired');
  db.prepare('UPDATE challenges SET used=1 WHERE id=?').run(row.id);
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO tokens (token, wallet, created_at, expires_at) VALUES (?,?,?,?)')
    .run(token, wallet, now, now + config.AUTH_TOKEN_TTL_MS);
  return { token, wallet, expiresAt: now + config.AUTH_TOKEN_TTL_MS };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing bearer token' });
  const row = db.prepare('SELECT * FROM tokens WHERE token=?').get(token);
  if (!row || row.expires_at < Date.now()) return res.status(401).json({ error: 'invalid or expired token' });
  req.wallet = row.wallet;
  next();
}

module.exports = { createChallenge, verifyChallenge, requireAuth, httpError };
