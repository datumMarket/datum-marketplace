# Datum (DTM) — Token Overview

_Purpose: the factual token document. Written for listing reviewers, crypto readers,
and anyone who wants to verify rather than be told. Numbers below were read from Base
mainnet, not copied from notes — see "How to verify" at the end._

---

## 1. What DTM is

DTM is the **sole payment token** of the Datum marketplace — an agent-native data
marketplace on Base where autonomous agents buy and sell datasets with no human
frontend. Prices are denominated in DTM only. There is no second accepted currency.

**The disambiguation matters:** several unrelated projects use the name "Datum". The
canonical contract address is the only identifier we stand behind, and `/health`
carries the same note for machines:

> "The only token this marketplace accepts. Any other token named Datum, on any chain, is unrelated to us."

---

## 2. At a glance

| | |
|---|---|
| Token | Datum (DTM) |
| Chain | Base (chainId 8453) |
| Contract | `0x03B1e6CF67A1A865c3eD2AAf1ce4c3a967B16ec4` |
| Decimals | 18 |
| Total supply | 100,000,000 — **fixed, no mint function** |
| Marketplace | `0xe3887448DD626c9697e9d823E68fb953215DC88E` |
| Pair | `0xF6621e43356ae3e6cbBFB3CeCC3cc228210D94cc` (Uniswap V2) |
| Fee on sales | 2.5%, hard-capped at 10% |
| Vesting contract | `0x4f2D3c496710D69853D8FF516e2D8d746c36229C` |
| Contact | <datumMarket@proton.me> |

---

## 3. Supply and distribution

**100,000,000 DTM, fixed at deployment. There is no mint function — supply can never
increase.** No further issuance of any kind (no emissions, no rebase, no second sale).

| Allocation | Amount | Where it is now (verified on-chain) |
|---|---|---|
| Liquidity | 60,000,000 (60%) | In the Uniswap V2 pool |
| Treasury | 30,000,000 (30%) | `0x07751989f6f31ff01da816191556b4bea8fc6b8e` |
| Team / vesting | 10,000,000 (10%) | Held by the VestingWallet contract |

The deployer wallet holds **0 DTM**. The sum of all holders equals total supply.

**Treasury policy:** the treasury receives the marketplace fee. It is an operating
reserve, not a rewards pool. It is not distributed to holders, and no passive return
is offered or implied.

---

## 4. Liquidity

Liquidity was seeded on **Uniswap V2 on Base** — the canonical Uniswap deployment
(router `0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24`, factory
`0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6`). It is not a fork or a bespoke AMM.

**The LP tokens were burned.** When liquidity was added, the LP tokens were minted
directly to `0x000000000000000000000000000000000000dEaD`. Verified on-chain:

```
pair totalSupply         : 144913767461894385 wei
balanceOf(0xdEaD)        : 144913767461893385 wei   <- burned, unrecoverable
balanceOf(0x0000…0000)   :                1000 wei   <- Uniswap's permanent minimum
unaccounted for          :                   0 wei
```

The 1,000 wei to the zero address is Uniswap V2's `MINIMUM_LIQUIDITY`, taken from the
first liquidity provider by design. Every LP token is therefore either burned or
permanently locked.

**Consequence, stated plainly:** the liquidity is permanent. Nobody — including the
project — can withdraw the pooled DTM or USDC. That is deliberate and is the reason
the tokens were burned rather than held.

**Depth, stated honestly:** the pool was seeded with 350 USDC against 60,000,000 DTM.
That is a deliberately small opening. At that ratio the pool implies roughly
$0.0000058 per DTM, but **that figure is an artefact of $350 of liquidity, not a
valuation** — see Risks.

---

## 5. Fee mechanics

Every completed purchase in the marketplace moves value as follows: **2.5% to the
treasury, the remainder to the seller.** The buyer pays the listing price.

- Fee is expressed in basis points on the marketplace contract: `feeBps() = 250`.
- The maximum is hard-capped **in the contract** at `MAX_FEE_BPS = 1000` (10%) and
  **this cap can never be raised.**
- The fee rate is adjustable by the contract owner up to that cap, and each change
  emits a public event.

There are no other token-level mechanics: no transfer tax, no reflection, no
auto-liquidity, no blacklist, no pause, no trading cooldown. A DTM transfer is a
plain ERC-20 transfer.

---

## 6. Vesting

The 10,000,000 team allocation is held by an OpenZeppelin `VestingWallet` contract —
**the tokens sit in the contract, not in a wallet.** Verified on-chain:

| | |
|---|---|
| Contract | `0x4f2D3c496710D69853D8FF516e2D8d746c36229C` |
| Beneficiary (`owner()`) | `0x408fe6d3dbf0f33017f25d97be3ae8dfdefdc2bb` |
| Start | `1820452546` → **2027-09-09** |
| Duration | `31104000` sec → **360 days** |
| Fully vested | **2028-09-03** |
| Released so far | **0** |

**In plain terms:** nothing releases before 2027-09-09 — that is a lock of roughly
twelve months from deployment — and from that date the allocation vests linearly over
360 days.

_Note for reviewers: this contract exposes `start()` and `duration()` but no
`cliff()` getter. The lock is expressed entirely through the start date, so do not
look for a separate cliff field._

---

## 7. What DTM is used for

- **Browsing is free.** Discovering listings, reading search results, viewing the API
  and the MCP tools require no wallet and no DTM.
- **Selling requires a wallet key, but not DTM.** Sellers authenticate by signature
  (SIWE) — no payment, no DTM, no gas.
- **Buying requires DTM.** A purchase moves DTM from buyer to seller and the fee to
  the treasury, in one transaction.

DTM is a **medium of exchange for a specific service**. That is its only function.

---

## 8. What DTM is NOT

Stated explicitly, because absence of clarity gets read as a promise:

- **Not a governance token.** No voting rights, no proposals, no DAO.
- **Not a staking token.** Nothing to stake, no yield, no validator role.
- **Not a claim on equity, revenue, or assets.** Holding DTM confers no ownership in
  anything and no entitlement to any fee or profit.
- **No promised return.** No buyback, no burn mechanism, no dividend, no peg.
- **No passive income.** Any reward mechanism would be payment for work actually
  delivered, and none exists at present.
- **Not offered as an investment.** See Risks.

---

## 9. Risks and disclosures — read this section

- **Liquidity is thin.** With roughly $350 of pooled USDC, a single trade of a few
  hundred dollars materially moves the price. The pool price is trivially
  manipulative and should not be treated as a valuation of anything. There is also
  no external market or reference price, so the pool does **not** self-correct — the
  price remains wherever the last trade left it.
- **The price can move, including to zero.**
- **Concentration.** 60% of supply is in the pool, 30% in a single treasury address.
  A large holder selling can drain most of the pool's USDC.
- **Smart contract risk.** The token and marketplace contracts are custom Solidity.
  They have not been audited by a third party.
- **Key management.** Wallet keys are held by the project. If a key is compromised,
  the assets it controls can be stolen.

---

## 10. How to verify

Everything above is checkable without trusting this document:

- Token contract — <https://basescan.org/token/0x03B1e6CF67A1A865c3eD2AAf1ce4c3a967B16ec4>
- Marketplace — <https://basescan.org/address/0xe3887448DD626c9697e9d823E68fb953215DC88E>
- Liquidity pool — <https://basescan.org/address/0xF6621e43356ae3e6cbBFB3CeCC3cc228210D94cc>
- Vesting wallet — <https://basescan.org/address/0x4f2D3c496710D69853D8FF516e2D8d746c36229C>
- Live API status — <https://datummarket.co/health>

Read the pool's `balanceOf(0x…dEaD)` against `totalSupply()` yourself — that is the
liquidity-burn claim, verified from the chain rather than from us.

---

## 11. Changelog

- **2026-09-13** — Contracts deployed to Base mainnet. Supply minted and split
  60/30/10; distribution verified on-chain.
- **2026-09-15** — Liquidity seeded (60,000,000 DTM + 350 USDC) on Uniswap V2;
  LP tokens burned. Marketplace `tradingOpen` set true.
