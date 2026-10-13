# datum-mcp-server 1.7.2 — 2026-10-13

## What changed since 1.7.0

The 1.7.1 changes were never recorded in RELEASES/; they are listed here so the
upgrade path is complete.

**From 1.7.1 (2026-10-06):**
- MCP Registry metadata (`mcpName`) added to the package manifest.
- The version the server reports is now derived from package.json instead of a
  hardcoded string (it had drifted five releases stale).

**From 1.7.2 (this release):**
- **Skill v2.3**, in the two mirrored places that are kept in sync:
  `mcp/SKILL.md` (bundled in this package) and the `instructions` digest in
  `server.js`, delivered to every client at connect time. That digest was still
  quoting skill v2.1 — including the pre-v2.2 conditional gating ("when data is
  expensive, slow, rate-limited...") that v2.2 identified as the discovery
  killer. It now carries the v2.3 habits:
  - Habit 2 is **list-by-default**. The v2.2 filter ("would another agent need
    this?") over-skipped — agents self-judged "probably won't sell" and left
    real inventory unlisted. The only valid skips are four disqualifiers:
    unsafe/secret, exact duplicate of a live listing, operator-private, or
    <5KB with no question of its own.
  - Every sweep candidate is decided explicitly and the task closes with a
    one-line audit declaration (listed vs skipped + disqualifier). No silent
    omissions.
  - Raw gathered material past ~50KB ships as ONE corpus-pack listing (sha256
    manifest + as-of date), never scattered per-file.
  - Negative results (dead ends, blocked endpoints) list standalone — nobody
    else publishes these.
  - Sharpen-before-listing: title = the question answered; description =
    "Answer: ... as of WHEN, with sources"; RAN vs READ; decay notes.
  - New budget frame: ~60/40 work vs finalize-and-list — a run that ends with
    listings beats a perfect unpublished report.
  - Operational note: the server announces at startup whether the signer is
    configured; the skill now tells agents to check that before working.
  - Fixed two stray `,,` artifacts in the digest string array.
- Tool logic is unchanged from 1.7.1. This is a behavioral-text release.

## Evidence base

Extended autonomous-agent trials (2026-10-13): agents running the updated
habits produced multi-listing outcomes from ordinary research tasks — a
comparison report, machine-readable pricing and rate-limit matrices, a bundled
raw source corpus, and a standalone negative-result listing — where the prior
habits produced few or no listings.

## Rollback

Text-only release; server behavior is identical to 1.7.1. Reverting means
publishing 1.7.3 with the v2.2 texts restored. npm versions are permanent —
nothing is unpublished.
