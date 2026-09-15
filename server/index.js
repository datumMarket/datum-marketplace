// Datum Marketplace API — entrypoint.
// Plain REST, agent-native: SIWE-lite auth, listings CRUD, on-chain-verified
// purchases, HMAC-signed download URLs.
const express = require('express');
const config = require('./src/config');
const db = require('./src/db');
const chain = require('./src/chain');
const { createChallenge, verifyChallenge } = require('./src/auth');
const { sweepStaging } = require('./src/storage');

const app = express();
app.disable('x-powered-by');
// Behind nginx (and Cloudflare), trust only the local proxy so req.ip is the
// real client. Without this, every request would appear to come from 127.0.0.1
// and all callers would share a single rate-limit bucket.
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*'); next(); });

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    chainId: config.CHAIN_ID,
    // Canonical token identity. Published here so an agent (or a human) can
    // verify WHICH Datum it is dealing with before any money moves. There are
    // unrelated projects using this name; the contract address is the only
    // thing that actually disambiguates.
    token: {
      name: 'Datum',
      symbol: config.TOKEN_SYMBOL,
      chainId: config.CHAIN_ID,
      address: config.TOKEN_ADDRESS,
      marketplace: config.MARKETPLACE_ADDRESS,
      decimals: config.TOKEN_DECIMALS,
      note: 'The only token this marketplace accepts. Any other token named Datum, on any chain, is unrelated to us.',
    },
    marketReady: chain.marketReady(),
    tradingOpen: config.TRADING_OPEN,
    ...(config.TRADING_OPEN
      ? {}
      : { tradingNote: 'Trading is not open yet: DTM has no liquidity pool, so purchases cannot settle. Listings, requests and downloads work normally.' }),
    contact: config.CONTACT_EMAIL,
    feedback: '/feedback',
    activeListings: db.prepare("SELECT COUNT(*) AS c FROM listings WHERE status='active'").get().c,
    openRequests: db.prepare("SELECT COUNT(*) AS c FROM requests WHERE status='open'").get().c,
    storage: require('./src/storage/driver').getDriver().kind,
    llms: '/llms.txt',
    openapi: '/openapi.yaml',
  });
});

// Public discovery files (A4): agents and search engines read these at the
// canonical URL. llms.txt is the agent-facing pitch; openapi.yaml is the spec.
const ROOT_DIR = require('path').join(__dirname, '..');
function serveDiscovery(rel, type) {
  return (req, res) => {
    res.type(type);
    res.sendFile(rel, { root: ROOT_DIR }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'not found' });
    });
  };
}
app.get('/llms.txt', serveDiscovery('llms.txt', 'text/plain; charset=utf-8'));
app.get('/openapi.yaml', serveDiscovery('docs/openapi.yaml', 'text/yaml; charset=utf-8'));

app.post('/auth/challenge', (req, res, next) => {
  try { res.json(createChallenge((req.body || {}).wallet)); } catch (e) { next(e); }
});
app.post('/auth/verify', (req, res, next) => {
  try {
    const { wallet, message, signature } = req.body || {};
    res.json(verifyChallenge(wallet, message, signature));
  } catch (e) { next(e); }
});

app.use('/', require('./src/routes/listings'));
app.use('/', require('./src/routes/purchases'));
app.use('/', require('./src/routes/download'));
app.use('/', require('./src/routes/requests'));
app.use('/', require('./src/routes/feedback'));
app.use('/', require('./src/routes/searches'));

app.use((req, res) => res.status(404).json({ error: 'not found' }));
app.use((err, req, res, next) => {
  const status = err.status || (err.name === 'MulterError' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'internal error' });
});

sweepStaging();
chain.startIndexer();
app.listen(config.PORT, () => {
  console.log(`datum-marketplace api on :${config.PORT} (chain ${config.CHAIN_ID}, marketReady=${chain.marketReady()})`);
});
