# Releasing Datum

Three rules, in order of priority:

1. **Nothing ships unreviewed.** Every change lands on a branch, gets read, and is
   described in release notes before it reaches a runner.
2. **Nothing ships without a backup.** The deploy takes its own snapshot first —
   see `backupRemote` in `scripts/provision-hetzner.js`. This is not optional and
   not a checklist item someone has to remember.
3. **Every release is reversible.** `rollback` restores the snapshot. If you
   cannot roll back, you are not ready to deploy.

---

## What actually ships, and where

Three surfaces. They are independent — you can ship one without the others, and
you should know which you are touching.

| Surface | Lives in | Reaches users via |
|---|---|---|
| **API** | `server/` | rsync to `/opt/datum` on the Hetzner box + `systemctl restart datum-api` |
| **npm package** `datum-mcp-server` | `mcp/` | a `v*` git tag → GitHub Actions publishes via OIDC trusted publishing |
| **Docs** | `llms.txt`, `GUIDE.md`, `skill/` | carried by the same rsync; `llms.txt` is served live at `/llms.txt` |

**Contracts are not in this table on purpose.** `contracts/` does not ship with a
normal release. Deploying contracts is a separate, deliberate act with its own
runbook — see `docs/MAINNET-RUNBOOK.md`. If a release would change a contract,
stop and treat it as a different kind of release entirely.

Note the coupling: **any `v*` tag triggers an npm publish.** Do not tag the repo
for a change set you do not want on npm.

## Version axes

- **Repo / release tag** — `v1.1.0`, describes the API release.
- **npm package version** — `mcp/package.json`. Independent, and only moves when
  the installed client changes.

---

## The process

### 1. Branch

```bash
git checkout -b release/v1.1.0
```

One release, one branch. Even a one-line fix, because the branch is what makes
the diff readable.

### 2. Preflight

```bash
node scripts/release-check.js
```

Fails loudly on: syntax errors in changed JS, a working tree you have not
committed, or any credential-shaped file staged for the transfer. Do not deploy
past a red preflight.

### 3. Commit and open a PR

```bash
git add -A && git commit -m "release: v1.1.0 — <one line>"
git push -u origin release/v1.1.0
gh pr create --fill
```

The PR body must state **what changes for a user**, not which files changed.

### 4. Review

Read the diff before merging. Specifically look for:

- anything in `server/`, `contracts/`, `mcp/`, `web/` — the shipping surface
- any credential, key, or token path
- whether the change is reversible

Then merge to the default branch.

### 5. Release notes

Write them **before** deploying, not after:

```bash
RELEASES/v1.1.0.md
```

State plainly: what was broken, what is different now, what is *not* touched, and
how it was verified. "Verified" means an observed result, not an intention.

### 6. Tag

```bash
git tag v1.1.0 && git push origin v1.1.0
```

Only when the npm package has actually changed. Remember the coupling above.

### 7. Deploy

```bash
node scripts/provision-hetzner.js deploy
```

This, in order: asserts no credential paths are in the transfer → snapshots
`/opt/datum` (server + data) to `/opt/datum-backups/<timestamp>.tar.gz` and
records it in `infra/last-deploy.json` → rsyncs → installs deps → restarts →
waits for `/health`. It prints the rollback command when it finishes.

### 8. Verify

Not "the command exited zero." Check the thing itself:

```bash
curl -s https://datummarket.co/health
node scripts/provision-hetzner.js backups     # the snapshot exists
```

And for a release that changed behaviour, check the behaviour — not the deploy.

### 9. Rollback

```bash
node scripts/provision-hetzner.js rollback              # most recent snapshot
node scripts/provision-hetzner.js rollback <backup.tgz> # a specific one
```

Stops the API, restores the snapshot over `/opt/datum`, starts it, waits for
health. Snapshot paths are validated before use, so a typo cannot restore
something arbitrary.

---

## Known gaps

Honest list, so nobody assumes these are handled:

- **The rsync transfers the whole repo** minus an exclude list. New sensitive
  paths must be added to `excludes` in `rsyncCode` explicitly — rsync does not
  read `.gitignore`. `assertNoSecrets()` is the backstop, and it fails closed.
- **Backups are on the same host.** They protect against a bad deploy, not
  against losing the box. Offsite copies are not yet part of this process.
- **`server/.env` is never overwritten** by a deploy. Config changes are manual
  and therefore unreviewed — treat that as a known hole.
- **The indexer re-scans from `MARKETPLACE_DEPLOY_BLOCK` after every restart.**
  Inserts are idempotent (`INSERT OR IGNORE`) so this is correct, just wasteful.
