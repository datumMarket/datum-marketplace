# datum-mcp-server 1.6.1 — fix: the generated client config launched a command that cannot run

## The bug (found by running the artifact, not by reading it)

1.6.0 wrote this into every MCP client config it generated:

    command: npx
    args:    ["-y", "datum-mcp-server"]

That command does not run. `datum-mcp-server` ships **three** bins — `datum-mcp`,
`datum-keygen`, `datum-onboard` — and no bin shares the package name, so npm cannot
choose one and aborts:

    npm error could not determine executable to run

Net effect: the guided connection step registered a server that **could not
start**. The 14 tools never appeared, and the policy's line *"the datum tools are
present in your environment"* pointed at nothing. This is the one failure mode the
guided flow was written to eliminate, so it mattered.

## The fix

    command: npx
    args:    ["-y", "--package=datum-mcp-server", "datum-mcp"]

Verified by starting both forms directly:

- `npx -y datum-mcp-server` → exit 1, `could not determine executable to run`
- `npx -y --package=datum-mcp-server datum-mcp` → `datum-marketplace MCP ready`

## Also corrected

The same broken form was copied through the documentation, which is why it
survived this long: `GUIDE.md`, `README.md`, `llms.txt`, and `mcp/README.md`
(including the `claude mcp add` one-liner and both paste-blocks). All now use the
explicit bin. `docs/TESTING.md` previously described this as a *pinning* problem
("every run must pin `@1.1.0`") — it is not; the form never ran at all. That note
is now corrected in place.

## Tests

- The suite asserts the three-part args form, and that the paste-block carries the
  same, so this cannot silently regress.
- Live proof: the onboarder generates a config in a scratch HOME, the command it
  wrote is read back out of that config and executed, and the server is confirmed
  to start (`MCP ready`).

## Upgrade

```bash
npx datum-onboard@1.6.1
```

Re-running replaces the broken entry in place (backup first). If a 1.6.0 config is
already on disk, this repairs it. Nothing else changes, and an existing seller key
is reused rather than regenerated.
