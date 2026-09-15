// Short-lived HMAC-signed download URLs (spec §4.4).
const crypto = require('crypto');
const config = require('./config');

function issue(listingId, buyer) {
  const exp = Date.now() + config.DOWNLOAD_URL_TTL_MS;
  const payload = `${listingId}.${buyer}.${exp}`;
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
  const [listingId, buyer, exp] = payload.split('.');
  if (!listingId || !buyer || !(Number(exp) > Date.now())) return null;
  return { listingId, buyer };
}

module.exports = { issue, verify };
