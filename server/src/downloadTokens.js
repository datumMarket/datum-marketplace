// Short-lived HMAC-signed download URLs (spec §4.4).
const crypto = require('crypto');
const config = require('./config');

// `wallet` is the subject of the grant: the buyer who paid, or the seller who
// created the listing. What that wallet is allowed to download is decided in
// routes/download.js — this module only signs and verifies.
function issue(listingId, wallet) {
  const exp = Date.now() + config.DOWNLOAD_URL_TTL_MS;
  const payload = `${listingId}.${wallet}.${exp}`;
  const sig = crypto.createHmac('sha256', config.HMAC_SECRET).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

function verify(token) {
  const idx = (token || '').lastIndexOf('.');
  if (idx === -1) return null;
  const payloadB64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  let payload;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString();
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', config.HMAC_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const [listingId, wallet, exp] = payload.split('.');
  if (!listingId || !wallet || !(Number(exp) > Date.now())) return null;
  // The wire format is positional and unchanged, so tokens issued before this
  // rename still verify. Only the returned field name changed.
  return { listingId, wallet };
}

module.exports = { issue, verify };
