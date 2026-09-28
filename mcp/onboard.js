#!/usr/bin/env node
'use strict';
/*
 * datum-onboard — set an agent up on Datum in one command.
 *
 * Three guided steps, each one confirmation:
 *   1. seller wallet   — generated locally; the key goes straight into the MCP
 *                        client config (0600) and is NEVER printed
 *   2. connection      — the Datum MCP server registered in that client config,
 *                        which is what makes the 14 datum tools exist
 *   3. policy          — the every-task block in the agent's instruction file
 *
 * Safety properties, all deliberate:
 *   * the key never appears in argv, in shell history, in stdout, or in --json
 *     (that is why this writes the client config directly instead of shelling
 *     out to `openclaw mcp add` / `claude mcp add`, which take it as an argument)
 *   * every file is backed up to <file>.datum-bak before its first change and
 *     then written atomically (temp + rename), mode 0600
 *   * a config that does not parse, or a target key that is not an object, is a
 *     hard error — this never guesses and never rewrites what it cannot read
 *   * re-running is a no-op: the server entry is replaced in place, the policy
 *     is marker-wrapped, and an existing seller key is reused rather than
 *     regenerated
 *   * zero network calls
 *
 * Usage:
 *   npx datum-onboard                  # detect, then confirm each step
 *   npx datum-onboard --yes            # non-interactive: accept all steps
 *   npx datum-onboard --list           # show candidate files for this machine
 *   npx datum-onboard --print          # print the policy block, change nothing
 *   npx datum-onboard --dry-run        # show every planned change
 *   npx datum-onboard --target <file>          # explicit instruction file
 *   npx datum-onboard --client-config <file>   # explicit MCP client config
 *   npx datum-onboard --no-connect     # policy only (skip server + wallet)
 */

const fs = require('fs');
const path = require('path');
const { detect } = require('./onboard/detect');
const { mergePolicy } = require('./onboard/merge');
const mcpClient = require('./onboard/client');
const pkg = require('./package.json');

const BLOCK_PATH = path.join(__dirname, 'onboard', 'policy-block.md');
const DEFAULT_CAP = 1000;
const KEY_FILE_BASENAMES = ['.env', '.env.local', 'id_rsa', 'id_ed25519', 'id_ecdsa'];

function parseArgs(argv) {
  const a = {
    yes: false, dryRun: false, list: false, print: false, json: false, help: false,
    target: null, cap: null, clientConfig: null, noConnect: false, noWallet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--yes' || v === '-y') a.yes = true;
    else if (v === '--dry-run') a.dryRun = true;
    else if (v === '--list') a.list = true;
    else if (v === '--print') a.print = true;
    else if (v === '--json') a.json = true;
    else if (v === '--help' || v === '-h') a.help = true;
    else if (v === '--target') a.target = argv[++i];
    else if (v === '--cap') a.cap = argv[++i];
    else if (v === '--client-config') a.clientConfig = argv[++i];
    else if (v === '--no-connect') { a.noConnect = true; a.noWallet = true; }
    else if (v === '--no-wallet') a.noWallet = true;
    else { console.error(`datum-onboard: unknown option "${v}" (try --help)`); process.exit(2); }
  }
  return a;
}

function loadBlock(cap) {
  const raw = fs.readFileSync(BLOCK_PATH, 'utf8');
  const resolved = String(cap || process.env.DATUM_MAX_PRICE_DTM || DEFAULT_CAP);
  if (!/^\d+$/.test(resolved)) {
    throw new Error(`spend cap must be a whole number of DTM (got "${resolved}")`);
  }
  return raw.replace(/\{\{MAX_PRICE_DTM\}\}/g, resolved);
}

function capFromBlock(block, fallback) {
  return /Hard cap: (\d+) DTM/.exec(block)?.[1] || String(fallback || DEFAULT_CAP);
}

/** Refuse targets that look like credential stores. */
function assertSafeTarget(file) {
  const base = path.basename(file).toLowerCase();
  if (KEY_FILE_BASENAMES.includes(base) || /\.(key|pem|p12|pfx)$/.test(base)) {
    throw new Error(`refusing to write policy into "${file}" — that looks like a credential file`);
  }
}

/** Atomic write with a one-deep backup. Returns true when bytes changed. */
function writeFileSafe(file, content) {
  assertSafeTarget(file);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) {
    const prev = fs.readFileSync(file, 'utf8');
    if (prev === content) return false;
    fs.copyFileSync(file, `${file}.datum-bak`);
  }
  const tmp = path.join(dir, `.datum-onboard.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return true;
}

function chooseTarget(flags, found) {
  if (flags.target) return { file: path.resolve(flags.target), why: 'explicit --target' };
  const existing = found.find((c) => c.exists && c.isFile && c.writable);
  if (existing) return { file: existing.file, why: `${existing.label} (detected)` };
  const oc = found.find((c) => c.id === 'openclaw' && c.writable);
  if (oc) return { file: oc.file, why: 'OpenClaw workspace default' };
  const any = found.find((c) => c.writable);
  if (any) return { file: any.file, why: `${any.label} (default)` };
  return null;
}

/** Generate a wallet lazily so `ethers` is only loaded when actually needed. */
function generateWallet() {
  const { Wallet } = require('ethers');
  return Wallet.createRandom();
}

function addressForKey(key) {
  try {
    const { Wallet } = require('ethers');
    return new Wallet(key).address;
  } catch {
    return null;
  }
}

function help() {
  console.log(`datum-onboard ${pkg.version} — set an agent up on Datum, guided.

Usage: npx datum-onboard [options]

  --list            show candidate instruction files and MCP client configs
  --print           print the policy block and exit (writes nothing)
  --dry-run         show what would change, write nothing
  --target <file>   instruction file to write the policy into
                    (default: auto-detected — OpenClaw AGENTS.md, CLAUDE.md, ...)
  --client-config <file>   MCP client config to register the server in
  --cap <n>         spend cap written into the policy and the client env
                    (default ${DEFAULT_CAP} DTM, or $DATUM_MAX_PRICE_DTM)
  --no-connect      policy only: do not register the server or create a wallet
  --no-wallet       keep any existing key; do not generate a new one
  --yes, -y         accept every step, no prompts (for automation)
  --json            machine-readable summary on stdout (never contains the key)
  -h, --help        this text

Three steps, each one confirmation:
  1. seller wallet   the private key is written to your MCP client config (0600)
                     and is never printed to this terminal
  2. connection      the Datum MCP server is registered in that config, which is
                     what gives your agent the datum tools
  3. policy          the every-task block is written into your agent's
                     instruction file, marker-wrapped and replaced in place

Every file is backed up to <file>.datum-bak before its first change. Re-running
is a no-op. Nothing is sent anywhere by this tool.`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) return help();

  const block = loadBlock(flags.cap);
  if (flags.print) { process.stdout.write(block); return; }

  const instructionFiles = detect();
  const clientConfigs = mcpClient.detect();
  const cap = capFromBlock(block, flags.cap || process.env.DATUM_MAX_PRICE_DTM);

  if (flags.list) {
    console.log('Instruction files (where the policy goes):');
    for (const c of instructionFiles) {
      const state = c.exists ? (c.isFile ? `${c.size} bytes` : 'not a regular file') : 'missing';
      console.log(`  ${c.id.padEnd(14)} ${c.writable ? 'writable' : 'read-only'}  ${state.padEnd(18)} ${c.file}`);
    }
    console.log('\nMCP client configs (where the server is registered):');
    for (const c of clientConfigs) {
      const state = c.exists ? (c.valid ? `${c.bytes} bytes` : `present, ${c.error}`) : 'missing';
      console.log(`  ${c.id.padEnd(14)} ${c.writable ? 'writable' : 'read-only'}  ${state.padEnd(18)} ${c.file}`);
    }
    return;
  }

  const target = chooseTarget(flags, instructionFiles);
  if (!target) {
    console.error('datum-onboard: no writable instruction file found. Use --target <file>.');
    process.exit(1);
  }

  const existingText = fs.existsSync(target.file) ? fs.readFileSync(target.file, 'utf8') : '';
  const policyPlan = mergePolicy(existingText, block);
  if (policyPlan.action === 'error') {
    console.error(`datum-onboard: ${policyPlan.error} (${target.file})`);
    process.exit(1);
  }

  // The client is chosen first: a generated key must have somewhere to live, so
  // we never mint one we cannot store.
  const chosen = flags.noConnect ? null : mcpClient.pick(clientConfigs, flags.clientConfig);

  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (!flags.yes && !interactive) {
    console.error('datum-onboard: not a TTY and --yes was not given. Re-run with --yes to accept defaults.');
    process.exit(2);
  }
  const rl = (interactive && !flags.yes)
    ? require('readline/promises').createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const ask = async (q) => (rl ? /^y(es)?$/i.test(String(await rl.question(q)).trim()) : true);
  const say = (...a) => { if (!flags.json) console.log(...a); };

  const summary = {
    tool: 'datum-onboard',
    version: pkg.version,
    cap,
    dryRun: Boolean(flags.dryRun),
    wallet: { reused: false, generated: false, address: null },
    client: chosen
      ? { id: chosen.id, label: chosen.label, file: chosen.file, action: 'skipped', wrote: false }
      : null,
    policy: { file: target.file, detected: target.why, action: policyPlan.action, wrote: false },
  };

  // ---------------------------------------------------------------- step 1/3
  let key = (process.env.DATUM_SIGNER_KEY || '').trim() || null;
  if (!key && chosen) key = mcpClient.existingKey(chosen.file, chosen.root, mcpClient.SERVER_NAME);

  if (key) {
    summary.wallet.reused = true;
    summary.wallet.address = addressForKey(key);
    say(`\nStep 1/3 — Seller wallet: reusing the existing key${summary.wallet.address ? ` for ${summary.wallet.address}` : ''}.`);
  } else if (!flags.noWallet && chosen) {
    const go = await ask('\nStep 1/3 — Seller wallet.\nGenerate one now? The private key is written straight into your MCP client\nconfig (mode 0600) and is never printed here. Selling needs no gas and no\nfunds. [y/N] ');
    if (go) {
      const w = generateWallet();
      key = w.privateKey;
      summary.wallet.generated = true;
      summary.wallet.address = w.address;
      say(`Generated a seller wallet: ${w.address}\nThe key is NOT printed — step 2 writes it into your client config.`);
    } else {
      say('Skipped. Selling stays off until a key is set — run `npx datum-keygen` when ready.');
    }
  } else if (!flags.noWallet && !chosen) {
    say('\nStep 1/3 — Seller wallet: no writable MCP client config found, so no key was\ncreated. Run `npx datum-keygen` and paste the key into the block shown below.');
  }

  // ---------------------------------------------------------------- step 2/3
  if (chosen) {
    const entry = mcpClient.serverEntry({ key, cap });
    const plan = mcpClient.planConfig(chosen.file, chosen.root, mcpClient.SERVER_NAME, entry);
    if (plan.action === 'error') {
      summary.client.action = 'error';
      say(`\nStep 2/3 — Connect: not registered — ${plan.error}`);
    } else {
      summary.client.action = plan.action;
      if (plan.action === 'unchanged') {
        say(`\nStep 2/3 — Connect: ${chosen.label} already has the Datum server registered. Nothing to change.`);
      } else {
        const go = await ask(`\nStep 2/3 — Connect to ${chosen.label}.\nRegister the Datum MCP server in:\n  ${chosen.file}\nThis is what gives your agent the datum tools. Proceed? [y/N] `);
        if (!go) {
          say('Skipped — the server was not registered.');
        } else if (flags.dryRun) {
          say('(dry run — nothing written)');
        } else {
          summary.client.wrote = writeFileSafe(chosen.file, plan.content);
          if (summary.client.wrote) say(`Registered (${plan.action}). Backup: ${chosen.file}.datum-bak`);
        }
      }
    }
  } else if (!flags.noConnect) {
    say('\nStep 2/3 — Connect: no known MCP client config was found on this machine.\nAdd this to your MCP client config, replacing the key:\n');
    say(mcpClient.pasteBlock({ cap }));
    say('\n(Generate that key with `npx datum-keygen`.)');
  }

  // ---------------------------------------------------------------- step 3/3
  if (policyPlan.action === 'unchanged') {
    say(`\nStep 3/3 — Policy: already current in ${target.file}. Nothing to do.`);
  } else {
    const verb = policyPlan.action === 'added' ? 'Add' : 'Update';
    const go = await ask(`\nStep 3/3 — Standing policy.\n${verb} the Datum every-task policy in:\n  ${target.file}\nProceed? [y/N] `);
    if (!go) {
      say('Skipped — the policy was not installed.');
    } else if (flags.dryRun) {
      say('(dry run — nothing written)');
    } else {
      summary.policy.wrote = writeFileSafe(target.file, policyPlan.content);
      if (summary.policy.wrote) say(`Written. Backup: ${target.file}.datum-bak`);
    }
  }

  if (rl) rl.close();

  if (flags.json) { console.log(JSON.stringify(summary, null, 2)); return; }

  const connected = summary.client && (summary.client.wrote || summary.client.action === 'unchanged');
  say('');
  if (summary.wallet.generated) {
    say('Back up your seller key: it lives in the config file above (mode 0600), and');
    say('whoever holds it controls the DTM your listings earn.');
  }
  if (connected && summary.policy.wrote) {
    say('Your agent is good to go. The policy loads the next time it starts a session:');
    say('it will search Datum before collecting data, and list what it produces after');
    say('every task — no marketplace wording needed in your prompts.');
  } else if (connected) {
    say('Server connected. Run again (or install the policy) to finish the setup.');
  } else if (summary.policy.wrote) {
    say('Policy installed. Connect the MCP server (step 2) to enable the datum tools.');
  }
  if (flags.dryRun) say('\n(dry run — nothing was written)');
}

main().catch((err) => {
  console.error(`datum-onboard: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
