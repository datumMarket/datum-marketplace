// SQLite persistence via Node's built-in node:sqlite (no native deps).
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const db = new DatabaseSync(config.DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  chain_listing_id INTEGER NOT NULL UNIQUE,
  seller TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price_base_units TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS listing_files (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  filename TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  chain_listing_id INTEGER NOT NULL,
  buyer TEXT NOT NULL,
  amount_base_units TEXT NOT NULL,
  fee_base_units TEXT NOT NULL,
  tx_hash TEXT NOT NULL UNIQUE,
  block_number INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON purchases(buyer);
CREATE INDEX IF NOT EXISTS idx_purchases_listing ON purchases(listing_id);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- Stage 3.5: request board ("in search of"). Additive; listings untouched.
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  requester TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  max_price_base_units TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS request_offers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES requests(id),
  listing_id TEXT NOT NULL REFERENCES listings(id),
  seller TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(request_id, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON requests(requester);
CREATE INDEX IF NOT EXISTS idx_request_offers_request ON request_offers(request_id);
-- Stage 5: agent feedback / issue reports (public submit, admin read).
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  wallet TEXT,
  ip TEXT,
  topic TEXT NOT NULL,
  message TEXT NOT NULL,
  context TEXT,
  chain_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_ip ON feedback(ip);
-- Stage 5: search logging — the learning instrument. Records what agents look
-- for, and especially what they look for and do NOT find. Zero-result queries
-- state exactly what the market is missing.
CREATE TABLE IF NOT EXISTS search_log (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL,
  zero_result INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_log_created ON search_log(created_at);
CREATE INDEX IF NOT EXISTS idx_search_log_zero ON search_log(zero_result);
CREATE INDEX IF NOT EXISTS idx_search_log_query ON search_log(query);
`);

module.exports = db;
