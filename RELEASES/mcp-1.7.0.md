# datum-mcp-server 1.7.0 — preview off, Apache-2.0, and download rights follow ownership

**Date:** 2026-09-30
**Touches:** the API (`server/`), the MCP client (`mcp/`), the served docs (`llms.txt`,
`GUIDE.md`, `README.md`, `docs/openapi.yaml`), the instruction block (`skill/`).
**Does not touch:** `contracts/`, and therefore nothing on-chain. Same token, same
marketplace, same addresses on Base. This is not a protocol release.

Four changes ship together in this version. Anyone installing from npm gets all four,
which is why they share one note — the two API-side changes were deployed ahead of the
package and are unreachable from a client without it.

---

## 1. The free preview is disabled (PC-001)

**What was wrong.** The sample route capped at an absolute byte count rather than a
proportion of the listing. Anything smaller than the cap was therefore returned **in
full** — for those listings the preview *was* the product. An audit on 2026-09-30 found
this was not an edge case: **all eight live listings were fully exposed**, every file,
free, unauthenticated and unthrottled, with the `sha256` in the public manifest to prove
the free copy was byte-identical to the paid one.

**The fix.** The route now refuses with `403` before the listing lookup and before any
storage call, unless `PREVIEW_ENABLED=true`:

```json
{"error":"previews are disabled pending a redesign; GET /listings/:id returns the file manifest (names, sizes, sha256)"}
```

`SAMPLE_BYTES` is retained for the rebuild. The feature is **planned to return**,
rebuilt as a seller-declared sample — the seller chooses what is public, instead of a
slicer guessing at safe bytes.

**What did not change.** The tool stays registered and reports the refusal, so the tool
count is unaffected by this change. `get_listing` still returns the file manifest —
names, sizes, sha256 — so a buyer loses no ability to judge a listing.

## 2. Apache-2.0

**What was wrong.** The repository had been public for weeks with **no `LICENSE` file**,
while `package.json` declared `ISC`. Public means readable, not usable: with no licence
the default is all-rights-reserved, so nobody could legally use, copy or modify it, and
"the code is public" was doing work that "open source" could not.

**The fix.** The canonical Apache-2.0 text, at the repo root and in `mcp/` — npm reads a
package-local `LICENSE`, so the package needs its own copy. Both manifest `license`
fields moved from `ISC` to `Apache-2.0`.

Apache rather than ISC for two clauses that cost nothing: §3 grants patents, and §6
carves out trademarks, so the project name stays the project's. It grants use rights,
never ownership of the token, the market or the business.

## 3. Download rights follow ownership, not purchase

**Two bugs, one rule.** Both were really the same question — *may this wallet download
listing X?*

- **`my_purchases` had a hard `LIMIT 100`.** Past 100 purchases the older rows still
  existed in the database, but there was no route to fetch them a download URL at all.
  A promise of permanent access was silently capped at the 100 most recent.
- **A seller had no path to its own listing.** Self-purchase is blocked (correctly — it
  would pay your own fee and emit a fake `Purchase` event) and `authorize()` required a
  purchase row, which a seller does not have. So an agent that listed data and then lost
  its local copy — compaction, a wiped workspace, another machine — could not reach the
  only surviving copy. A stranger could buy it; its author could not.

**The rule now:** a wallet may download a listing if it **bought** it or **created** it.

**New endpoints.** `GET /listings/:id/download-url` (auth) answers by id, so access no
longer depends on history paging. `GET /listings/mine` (auth) lists what the wallet
published — the mirror of `/purchases/mine`. `my_purchases` is paginated with
`limit`/`offset`.

**New tool.** `my_listings` — find your own published work and get it back. The tool
count is now **15**.

**Corrected.** `download_data` now asks by id instead of scanning purchase history, so
it works for a listing you created and is not capped by paging. Its description and
`my_purchases`' no longer say "purchased" where they mean "owned".

**Security.** The download URL is a bearer credential, so all the security is in who can
mint one — and minting happens behind `requireAuth`, a wallet signature. Both sides of
the comparison are read from the database, never from request input, and `seller` is set
at creation from the authenticated wallet and is immutable. There is no `?seller=` path.
The token's subject field was renamed `buyer` → `wallet`; the wire format is positional
and unchanged, so tokens issued before the rename still verify.

## 4. The version the server reports is now the version it ships

**What was wrong.** `mcp/server.js` hardcoded `version: '1.2.0'` in the MCP `Server`
constructor, so every client that connected was told **`datum-marketplace 1.2.0`** — five
releases behind the package it was actually running. It was invisible in the repo and
obvious the moment the artifact was exercised: the handshake against the installed 1.7.0
tarball reported `1.2.0`.

**The fix.** The version is read from the package manifest instead of typed by hand:

```js
const { version: SERVER_VERSION } = require('./package.json');
```

The reported version and the published version are now the same value by construction, so
this cannot drift again. Nothing else in the handshake changed: still `datum-marketplace`,
still 15 tools.

## Upgrade

```bash
npx datum-onboard@1.7.0
```

Re-running replaces the config entry in place, backup first, and an existing seller key
is reused rather than regenerated. Nothing else changes.

## What this release does not fix

The registry and the repository disagree until this publishes — the repo's `server/`
routes and the 15-tool client are ahead of what npm serves. Publishing closes both that
and the `ISC`/`Apache-2.0` mismatch in one step. Trusted publishing (OIDC) is configured
but has **never been proven end to end**; prove it before relying on it.
