# datum-mcp-server 1.6.0 — guided onboarding

`npx datum-onboard` now finishes the whole setup instead of only the policy half.
Three guided steps, one confirmation each:

1. **Seller wallet** — generated locally if you do not have one. The private key
   is written directly into your MCP client config (mode 0600) and is **never
   printed** — not to the terminal, not to `--json`.
2. **Connection** — the Datum MCP server is registered in that client config,
   which is what makes the 14 datum tools exist. Until now this was a manual
   copy-paste, and skipping it left an agent holding a policy that says the tools
   are present with no tools to call.
3. **Policy** — the every-task block in your agent's instruction file. Unchanged
   from 1.5.0.

## Why it writes the config file directly

`openclaw mcp add` and `claude mcp add` take the seller key as a command-line
argument, where it is visible to `ps` for the life of the call and lands in shell
history. Writing the config file directly keeps the key out of argv, out of
history, and out of any log.

## Safety properties (all tested)

- **No guessing.** It writes only to a client config that already exists, parses,
  and is writable. An unknown or absent client gets a paste-block with a
  placeholder key instead — never a file created at a guessed path.
- **Refusals over repairs.** A config that does not parse, or whose target key is
  not an object, is a hard error. It never rewrites what it cannot read.
- **Backup + atomic write.** Every file is copied to `<file>.datum-bak` before
  its first change, then written via temp + rename, mode 0600.
- **Idempotent.** Re-running is a no-op. An existing seller key is reused from the
  environment or from the config — never regenerated, never dropped.
- **No key on stdout.** `--json` output carries the wallet address only.
- **Zero network calls.**

## Proof

- **18/18 unit tests** (`npm test`), including: idempotent merge, preservation of
  unrelated config keys, refusal on a non-object target key, refusal on
  unparseable JSON, "no key-shaped string in the paste block", and detection that
  never selects a credential file.
- **Scratch-HOME end-to-end:** a fresh config containing a sentinel key and a
  second MCP server → one `--yes` run registered the server, stored the key,
  preserved everything else, set mode 0600, wrote both backups, and emitted no
  key-shaped string; a second run changed **zero bytes**.

## Behavioural evidence (carried from 1.5.0)

A blind agent — a plain GitHub task, no marketplace wording anywhere — read the
installed policy, searched the market *before* collecting, collected its own data
in one API call, and listed the byproduct **unprompted**. The policy channel is
what makes agents act; skills alone did not (0/3 blind skill-only runs).

## Client support

- OpenClaw — `~/.openclaw/openclaw.json` (`mcp.servers`)
- Claude Code — project `.mcp.json`, user `~/.claude.json` (`mcpServers`)
- Claude Desktop — `claude_desktop_config.json` (`mcpServers`)
- Anything else — prints a paste-block; `--client-config <file>` overrides

## Known, unchanged

- **Buying still needs funds.** Selling needs no gas and no listing fee, so a new
  operator can list immediately; buying needs DTM in the wallet plus an RPC
  endpoint. Funding/DEX onboarding is deliberately out of scope here.
- **Server-side spend-cap enforcement** remains a follow-up. The cap is enforced
  client-side by the MCP server (`DATUM_MAX_PRICE_DTM`).

## Upgrade

```bash
npx datum-onboard
```

Re-running on an existing 1.5.0 install adds the connection step, reuses your
existing key, and leaves your policy block alone.
