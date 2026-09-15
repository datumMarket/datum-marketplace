// Central config. Env overrides; safe dev defaults for local e2e.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'staging'), { recursive: true });

// HMAC secret for download tokens: env, else generated once and persisted 0600.
let HMAC_SECRET = process.env.HMAC_SECRET;
if (!HMAC_SECRET) {
  const secretFile = path.join(DATA_DIR, 'secret');
  if (fs.existsSync(secretFile)) {
    HMAC_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
  } else {
    HMAC_SECRET = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretFile, HMAC_SECRET, { mode: 0o600 });
  }
}

module.exports = {
  PORT: parseInt(process.env.PORT || '3737', 10),
  DATA_DIR,
  UPLOADS_DIR: path.join(DATA_DIR, 'uploads'),
  STAGING_DIR: path.join(DATA_DIR, 'staging'),
  DB_PATH: path.join(DATA_DIR, 'marketplace.db'),
  HMAC_SECRET,
  RPC_URL: process.env.RPC_URL || 'http://127.0.0.1:8545',
  CHAIN_ID: parseInt(process.env.CHAIN_ID || '31337', 10),
  TOKEN_ADDRESS: (process.env.TOKEN_ADDRESS || '').toLowerCase(),
  MARKETPLACE_ADDRESS: (process.env.MARKETPLACE_ADDRESS || '').toLowerCase(),
  MARKETPLACE_DEPLOY_BLOCK: parseInt(process.env.MARKETPLACE_DEPLOY_BLOCK || '0', 10),
  TOKEN_DECIMALS: 18,
  TOKEN_SYMBOL: process.env.TOKEN_SYMBOL || 'DTM',
  // Cloudflare caps a single request body at ~100MB and it is the BINDING
  // constraint: nginx allows 512m and the app could stream more, but anything
  // past the edge dies as a connection reset with no usable error. Measured
  // live against datummarket.co: 95MB uploads clean and intact, 110MB is
  // reset. Both caps sit under the edge with headroom so the failure is always
  // our own clear 4xx, never an opaque reset.
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE_MB || '95', 10) * 1024 * 1024,
  MAX_BUNDLE_SIZE: parseInt(process.env.MAX_BUNDLE_SIZE_MB || '95', 10) * 1024 * 1024,
  MAX_FILES: parseInt(process.env.MAX_FILES || '20', 10),
  SAMPLE_BYTES: parseInt(process.env.SAMPLE_BYTES || '16384', 10),
  ALLOWED_EXTENSIONS: (process.env.ALLOWED_EXTENSIONS || 'csv,json,jsonl,parquet,txt,md,pdf,png,jpg,jpeg,webp').split(','),
  AUTH_TOKEN_TTL_MS: parseInt(process.env.AUTH_TOKEN_TTL_HOURS || '24', 10) * 3600 * 1000,
  DOWNLOAD_URL_TTL_MS: parseInt(process.env.DOWNLOAD_URL_TTL_MINUTES || '60', 10) * 60 * 1000,
  CHALLENGE_TTL_MS: 10 * 60 * 1000,
  INDEX_INTERVAL_MS: parseInt(process.env.INDEX_INTERVAL_MS || '10000', 10),
  MAX_OPEN_REQUESTS_PER_WALLET: parseInt(process.env.MAX_OPEN_REQUESTS_PER_WALLET || '20', 10),
  MAX_OFFERS_PER_REQUEST: parseInt(process.env.MAX_OFFERS_PER_REQUEST || '50', 10),
  // Stage 5: discovery honesty + agent contact. TRADING_OPEN=false advertises that the
  // market is live but DTM has no liquidity pool yet (purchases cannot settle).
  TRADING_OPEN: (process.env.TRADING_OPEN || 'true').toLowerCase() !== 'false',
  CONTACT_EMAIL: process.env.CONTACT_EMAIL || 'datumMarket@proton.me',
  // Wallets allowed to read submitted feedback via GET /feedback (comma-separated).
  ADMIN_WALLETS: (process.env.ADMIN_WALLETS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  // Stage 4a storage driver: filesystem (default) | r2 (Cloudflare, zero egress)
  STORAGE_DRIVER: process.env.STORAGE_DRIVER || 'filesystem',
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || '',
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || '',
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || '',
  R2_BUCKET: process.env.R2_BUCKET || 'datum-uploads',
  R2_ENDPOINT: process.env.R2_ENDPOINT || '', // set only for tests/S3-compatible mocks
  R2_PRESIGN_TTL_SEC: parseInt(process.env.R2_PRESIGN_TTL_SEC || '900', 10),
};
