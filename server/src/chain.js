// On-chain layer: quotes, purchase-tx verification, Purchase event indexer.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ethers } = require('ethers');
const config = require('./config');
const db = require('./db');
const { httpError } = require('./auth');

const artifactsDir = path.join(__dirname, '..', '..', 'artifacts', 'contracts');
const marketArtifact = JSON.parse(
  fs.readFileSync(path.join(artifactsDir, 'DatumMarketplace.sol', 'DatumMarketplace.json'), 'utf8')
);

const provider = new ethers.JsonRpcProvider(config.RPC_URL);
const marketIface = new ethers.Interface(marketArtifact.abi);
const PURCHASE_TOPIC = marketIface.getEvent('Purchase').topicHash;

function marketReady() { return !!config.MARKETPLACE_ADDRESS; }

// Everything a buyer agent needs to build the purchase transaction.
function quote(listing) {
  if (!marketReady()) return { available: false, reason: 'marketplace not configured' };
  return {
    available: true,
    chainId: config.CHAIN_ID,
    marketplace: config.MARKETPLACE_ADDRESS,
    token: config.TOKEN_ADDRESS,
    tokenSymbol: config.TOKEN_SYMBOL,
    tokenDecimals: config.TOKEN_DECIMALS,
    listingId: listing.chain_listing_id,
    seller: listing.seller,
    amountBaseUnits: listing.price_base_units,
    amountDtm: ethers.formatUnits(listing.price_base_units, config.TOKEN_DECIMALS),
    steps: [
      `token.approve("${config.MARKETPLACE_ADDRESS}", "${listing.price_base_units}")`,
      `marketplace.purchase(${listing.chain_listing_id}, "${listing.seller}", "${listing.price_base_units}")`,
      `POST /purchases/confirm {listingId: "${listing.id}", txHash: "<0x...>"}`,
    ],
  };
}

// Verify a confirmed tx carries a Purchase event matching this listing exactly.
async function verifyPurchaseTx(txHash, listing) {
  const receipt = await provider.getTransactionReceipt(txHash).catch(() => null);
  if (!receipt) throw httpError(400, 'transaction not found (wrong chain or not mined yet?)');
  if (receipt.status !== 1) throw httpError(400, 'transaction reverted');
  const log = receipt.logs.find(
    (l) => l.address.toLowerCase() === config.MARKETPLACE_ADDRESS && l.topics[0] === PURCHASE_TOPIC
  );
  if (!log) throw httpError(400, 'no Purchase event in transaction');
  const parsed = marketIface.parseLog(log);
  if (parsed.args.listingId !== BigInt(listing.chain_listing_id))
    throw httpError(409, 'Purchase listingId does not match this listing');
  if (parsed.args.seller.toLowerCase() !== listing.seller.toLowerCase())
    throw httpError(409, 'Purchase seller does not match this listing');
  if (parsed.args.amount !== BigInt(listing.price_base_units))
    throw httpError(409, 'Purchase amount does not match listing price');
  const tx = await provider.getTransaction(txHash);
  return {
    buyer: tx.from.toLowerCase(),
    amount: parsed.args.amount.toString(),
    fee: parsed.args.fee.toString(),
    blockNumber: receipt.blockNumber,
  };
}

let indexing = false;
let lastIndexedBlock = 0;

async function indexPurchases() {
  if (!marketReady() || indexing) return;
  indexing = true;
  try {
    const latest = await provider.getBlockNumber();
    let from = lastIndexedBlock || config.MARKETPLACE_DEPLOY_BLOCK || latest;
    if (from > latest) return;
    const logs = await provider.getLogs({
      address: config.MARKETPLACE_ADDRESS,
      topics: [PURCHASE_TOPIC],
      fromBlock: from,
      toBlock: latest,
    });
    for (const log of logs) {
      try {
        const parsed = marketIface.parseLog(log);
        const listing = db
          .prepare('SELECT * FROM listings WHERE chain_listing_id=? AND seller=?')
          .get(parsed.args.listingId.toString(), parsed.args.seller.toLowerCase());
        if (!listing) continue; // purchase for an unknown listing (e.g. router reuse) — skip
        // Only credit purchases matching the listing price exactly. The
        // on-chain router is dumb: it emits Purchase for ANY amount, so
        // without this check a 1-wei purchase would grant download access.
        if (parsed.args.amount !== BigInt(listing.price_base_units)) continue;
        db.prepare(
          `INSERT OR IGNORE INTO purchases
           (id, listing_id, chain_listing_id, buyer, amount_base_units, fee_base_units, tx_hash, block_number, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(
          crypto.randomUUID(),
          listing.id,
          listing.chain_listing_id,
          parsed.args.buyer.toLowerCase(),
          parsed.args.amount.toString(),
          parsed.args.fee.toString(),
          log.transactionHash,
          log.blockNumber,
          Date.now()
        );
      } catch (e) {
        console.error(`indexer: skipped log ${log.transactionHash}: ${e.message}`);
      }
    }
    lastIndexedBlock = latest + 1;
  } catch (e) {
    console.error(`indexer: ${e.message}`);
  } finally {
    indexing = false;
  }
}

function startIndexer() {
  setInterval(indexPurchases, config.INDEX_INTERVAL_MS);
  indexPurchases();
}

module.exports = { marketReady, quote, verifyPurchaseTx, startIndexer, provider };
