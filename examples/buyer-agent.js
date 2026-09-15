#!/usr/bin/env node
// Example buyer agent — the full acquire loop against the Datum Marketplace.
// Usage: DATUM_API_URL=... DATUM_SIGNER_KEY=0x... DATUM_RPC_URL=... node examples/buyer-agent.js [query]
const { ethers } = require('ethers');
const fs = require('fs');

const API = (process.env.DATUM_API_URL || 'http://127.0.0.1:3737').replace(/\/$/, '');
const KEY = process.env.DATUM_SIGNER_KEY || '';
const RPC = process.env.DATUM_RPC_URL || '';
const query = process.argv[2] || '';

async function get(p) {
  const r = await fetch(API + p);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GET ${p} -> ${r.status}: ${d.error || ''}`);
  return d;
}
async function post(p, body) {
  const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`POST ${p} -> ${r.status}: ${d.error || ''}`);
  return d;
}

async function main() {
  if (!KEY) throw new Error('set DATUM_SIGNER_KEY (buyer wallet, needs DTM + gas)');

  // 1. Discover
  const found = await get(`/listings?q=${encodeURIComponent(query)}`);
  if (!found.listings.length) { console.log('no listings match — try another query'); return; }
  const pick = found.listings[0];
  console.log(`found: "${pick.title}" — ${pick.priceDtm} DTM — ${pick.id}`);

  // 2. Verify before paying
  const sample = await get(`/listings/${pick.id}/sample`);
  console.log(`sample (first bytes):\n${sample.slice ? sample.slice(0, 300) : JSON.stringify(sample).slice(0, 300)}\n`);

  // 3. Exact purchase recipe
  const quote = await get(`/listings/${pick.id}/quote`);
  if (!quote.available) throw new Error('marketplace not configured on API');

  // 4. Pay on-chain (explicit nonces: safe on automining local chains)
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const net = await provider.getNetwork();
  if (net.chainId !== BigInt(quote.chainId)) throw new Error(`chain mismatch: wallet on ${net.chainId}, listing expects ${quote.chainId}`);
  const price = BigInt(quote.amountBaseUnits);
  const erc20 = ['function allowance(address,address) view returns (uint256)', 'function approve(address,uint256) returns (bool)'];
  const marketAbi = ['function purchase(uint256 listingId, address seller, uint256 amount)'];
  const token = await ethers.Contract(quote.token, erc20, wallet);
  const market = new ethers.Contract(quote.marketplace, marketAbi, wallet);
  let nonce = await provider.getTransactionCount(wallet.address, 'latest');
  if ((await token.allowance(wallet.address, quote.marketplace)) < price) {
    console.log('approving token spend...');
    await (await token.approve(quote.marketplace, price * 10n, { nonce: nonce++ })).wait();
  }
  console.log(`purchasing for ${quote.amountDtm} DTM...`);
  const receipt = await (await market.purchase(quote.listingId, quote.seller, price, { nonce: nonce++ })).wait();

  // 5. Confirm + download
  const confirmed = await post('/purchases/confirm', { listingId: pick.id, txHash: receipt.hash });
  const zip = Buffer.from(await (await fetch(API + confirmed.downloadUrl)).arrayBuffer());
  const out = `datum-${pick.chainListingId}.zip`;
  fs.writeFileSync(out, zip);
  console.log(`confirmed in block ${confirmed.purchase.blockNumber} — downloaded ${zip.length} bytes -> ${out}`);
}

main().catch((e) => { console.error('buyer agent failed:', e.message); process.exit(1); });
