#!/usr/bin/env node
'use strict';
/*
 * datum-onboard — put the Datum every-task policy where your agent reads it.
 *
 * The policy block is what makes an agent search the market before it collects
 * data, and list what it produces (including methods and negative results)
 * after every task. Agents do not reliably discover this on their own: a
 * standing instruction file is the delivery channel that works.
 *
 * This tool is intentionally boring and safe:
 *   * it writes exactly one file, chosen by you, with a marker-wrapped block
 *   * it never deletes content, never prints a key, and never touches the
 *     network
 *   * re-running it is a no-op (the block is replaced in place, idempotently)
 *   * it refuses to write policy into credential-looking files
 *
 * Usage:
 *   npx datum-onboard              # detect, confirm, write
 *   npx datum-onboard --list       # show candidate instruction files
 *   npx datum-onboard --print      # print the block, change nothing
 *   npx datum-onboard --dry-run    # show what would change
 *   npx datum-onboard --yes        # non-interactive (for automation)
 *   npx datum-onboard --target ./CLAUDE.md
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { detect } = require('./onboard/detect');
const { mergePolicy, hasPolicy } = require('./onboard/merge');
const pkg = require('./package.json');

const BLOCK_PATH = path.join(__dirname, 'onboard', 'policy-block.md');
const DEFAULT_CAP = 1000;
const KEY_FILE_BASENAMES = ['.env', '.env.local', 'id_rsa', 'id_ed25519', 'id_ecdsa'];

function parseArgs(argv) {
  const a = { yes: false, dryRun: false, list: false, print: false, json: false, help: false, target: null, cap: null };
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

function help() {
  console.log(`datum-onboard ${pkg.version} — install the Datum every-task policy for your agent.

Usage: npx datum-onboard [options]

  --list            show candidate instruction files for this machine
  --print           print the policy block and exit (writes nothing)
  --dry-run         show what would change, write nothing
  --target <file>   write to this file instead of auto-detecting
  --cap <n>         spend cap written into the policy (default ${DEFAULT_CAP} DTM,
                    or $DATUM_MAX_PRICE_DTM)
  --yes, -y         accept defaults, no prompts (for automation)
  --json            machine-readable summary on stdout
  -h, --help        this text

The written block is marker-wrapped and replaced in place on re-runs, so your
other instructions are never disturbed. Existing files are backed up to
<file>.datum-bak before the first change.`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) return help();

  const block = loadBlock(flags.cap);
  if (flags.print) { process.stdout.write(block); return; }

  const found = detect();

  if (flags.list) {
    for (const c of found) {
      const state = c.exists ? (c.isFile ? `${c.size} bytes` : 'not a regular file') : 'missing';
      console.log(`${c.id.padEnd(12)} ${c.writable ? 'writable' : 'read-only'}  ${state.padEnd(18)} ${c.file}`);
    }
    return;
  }

  const target = chooseTarget(flags, found);
  if (!target) {
    console.error('datum-onboard: no writable instruction file found. Use --target <file>.');
    process.exit(1);
  }

  const existing = fs.existsSync(target.file) ? fs.readFileSync(target.file, 'utf8') : '';
  const merged = mergePolicy(existing, block);

  if (merged.action === 'error') {
    console.error(`datum-onboard: ${merged.error} (${target.file})`);
    process.exit(1);
  }

  const summary = {
    tool: 'datum-onboard',
    version: pkg.version,
    target: target.file,
    detected: target.why,
    action: merged.action,
    cap: /Hard cap: (\d+) DTM/.exec(block)?.[1] || String(DEFAULT_CAP),
    wrote: false,
    keyPresent: Boolean(process.env.DATUM_SIGNER_KEY),
  };

  if (merged.action === 'unchanged') {
    if (flags.json) console.log(JSON.stringify({ ...summary, alreadyCurrent: true }, null, 2));
    else console.log(`Already current — ${target.file} carries the current Datum policy. Nothing to do.`);
    return;
  }

  if (flags.dryRun) {
    if (flags.json) console.log(JSON.stringify({ ...summary, dryRun: true }, null, 2));
    else console.log(`Would ${merged.action === 'added' ? 'add' : 'update'} the Datum policy in:\n  ${target.file}\n(dry run — nothing written)`);
    return;
  }

  const interactive = process.stdin.isTTY && process.stdout.isTTY;

  if (!flags.yes && !interactive) {
    console.error('datum-onboard: not a TTY and --yes was not given. Re-run with --yes to accept defaults.');
    process.exit(2);
  }

  let confirm = flags.yes;
  if (!confirm) {
    const rl = require('readline/promises').createInterface({ input: process.stdin, output: process.stdout });
    const verb = merged.action === 'added' ? 'Add' : 'Update';
    const answer = await rl.question(`${verb} the Datum every-task policy in:\n  ${target.file}\nProceed? [y/N] `);
    confirm = /^y(es)?$/i.test(answer.trim());
    if (!confirm) { rl.close(); console.log('Aborted — nothing written.'); return; }

    if (summary.keyPresent) {
      console.log('\nSeller key detected (DATUM_SIGNER_KEY) — buying and selling are enabled.');
    } else {
      const gen = await rl.question('\nNo seller key found. Generate one now (prints once to this terminal)? [y/N] ');
      if (/^y(es)?$/i.test(gen.trim())) {
        rl.close();
        console.log('\nGenerating seller wallet…\n');
        const kg = spawnSync(process.execPath, [path.join(__dirname, 'keygen.js')], { stdio: 'inherit' });
        if (kg.status !== 0) console.error('datum-onboard: keygen failed — run `npx datum-keygen` manually.');
      } else {
        rl.close();
        console.log('\nSkipped. Run `npx datum-keygen` when you are ready — selling needs no gas.');
      }
    }
  }

  const changed = writeFileSafe(target.file, merged.content);
  summary.wrote = changed;

  if (flags.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`\n${changed ? (merged.action === 'added' ? 'Added' : 'Updated') : 'Unchanged'}: ${target.file}`);
  if (changed) console.log(`Backup (first change only): ${target.file}.datum-bak`);
  console.log('\nYour agent is good to go. The policy loads the next time it starts a session.');
  console.log('It will search Datum before collecting data, and list what it produces after every task.');
  if (!summary.keyPresent) {
    console.log('\nTo enable buying and selling, set DATUM_SIGNER_KEY in your MCP client env block');
    console.log('(run `npx datum-keygen` if you have not). Keep the key out of chat and out of this file.');
  }
}

main().catch((err) => {
  console.error(`datum-onboard: ${err && err.message ? err.message : err}`);
  process.exit(1);
});
