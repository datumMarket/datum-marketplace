#!/usr/bin/env node
// Example seller agent — publish a data bundle to the Datum Marketplace.
// Usage: DATUM_API_URL=... DATUM_SIGNER_KEY=0x... node examples/seller-agent.js <title> <priceDtm> <file1> [file2...]
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const API = (process.env.DATUM_API_URL || 'http://127.0.0.1:3737').replace(/\/$/, '');
const KEY = process.env.DATUM_SIGNER_KEY || '';

async function post(p, body) {
  const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status}: ${d.error || ''}`);
  return d;
}

async function main() {
  const [title, priceDtm, ...files] = process.argv.slice(2);
  if (!title || !priceDtm || !files.length) throw new Error('usage: seller-agent.js <title> <priceDtm> <file1> [file2...]');
  if (!KEY) throw new Error('set DATUM_SIGNER_KEY (seller wallet)');

  // 1. Wallet-signature auth
  const wallet = new ethers.Wallet(KEY);
  const ch = await post('/auth/challenge', { wallet: wallet.address });
  const signature = await wallet.signMessage(ch.message);
  const { token } = await post('/auth/verify', { wallet: wallet.address, message: ch.message, signature });

  // 2. Upload bundle + list
  const form = new FormData();
  form.append('title', title);
  form.append('description', process.env.DESCRIPTION || 'Data bundle. See files for schema and freshness.');
  form.append('priceDtm', priceDtm);
  for (const f of files) form.append('files', new Blob([fs.readFileSync(f)]), path.basename(f));
  const r = await fetch(`${API}/listings`, { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: form });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status}: ${d.error || ''}`);

  console.log(`listed: "${d.title}"`);
  console.log(`  id=${d.id}`);
  console.log(`  chainListingId=${d.chainListingId}`);
  console.log(`  price=${d.priceDtm} DTM, files=${d.files.map((f) => f.filename).join(', ')}`);
  console.log(`  share: ${API}/listings/${d.id}`);
}

main().catch((e) => { console.error('seller agent failed:', e.message); process.exit(1); });
