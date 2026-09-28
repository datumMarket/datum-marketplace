'use strict';
// Tests for MCP client-config detection and the server-entry merge.
// No network, no writes to real user configs — everything runs in a temp dir.
// Run: npm test   (from mcp/)   — or: node --test test/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const client = require('../onboard/client');

function scratch() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'datum-client-'));
}

const FAKE_KEY = '0x' + 'ab'.repeat(32);

test('candidates cover the known clients and are platform-shaped', () => {
  const dir = scratch();
  const mac = client.candidates({ cwd: dir, home: dir, platform: 'darwin' });
  const ids = mac.map((c) => c.id);
  assert.deepEqual(ids, ['openclaw', 'claude-code', 'claude-code-user', 'claude-desktop']);
  assert.equal(mac[0].file, path.join(dir, '.openclaw', 'openclaw.json'));
  assert.deepEqual(mac[0].root, ['mcp', 'servers']);
  assert.deepEqual(mac[1].root, ['mcpServers']);

  const linux = client.candidates({ cwd: dir, home: dir, platform: 'linux' });
  assert.ok(linux.find((c) => c.id === 'claude-desktop').file.includes('.config'));
  const win = client.candidates({ cwd: dir, home: dir, platform: 'win32', env: { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' } });
  assert.ok(win.find((c) => c.id === 'claude-desktop').file.includes('AppData'));
});

test('inspect is safe on missing, unreadable-by-parse, and valid files', () => {
  const dir = scratch();
  const missing = path.join(dir, 'nope.json');
  const s1 = client.inspect(missing);
  assert.equal(s1.exists, false);
  assert.equal(s1.valid, true, 'a missing file is nothing to corrupt');
  assert.equal(s1.writable, true, 'directory is writable');

  const broken = path.join(dir, 'broken.json');
  fs.writeFileSync(broken, '{ not json');
  const s2 = client.inspect(broken);
  assert.equal(s2.exists, true);
  assert.equal(s2.valid, false);
  assert.match(s2.error, /not valid JSON/);

  const good = path.join(dir, 'good.json');
  fs.writeFileSync(good, '{"a":1}');
  assert.equal(client.inspect(good).valid, true);
});

test('pick selects only an existing, valid, writable config', () => {
  const dir = scratch();
  const cands = client.candidates({ cwd: dir, home: dir, platform: 'darwin' });
  assert.equal(client.pick(cands), null, 'nothing exists yet -> no target, no guessing');

  const oc = path.join(dir, '.openclaw', 'openclaw.json');
  fs.mkdirSync(path.dirname(oc), { recursive: true });
  fs.writeFileSync(oc, '{"mcp":{"servers":{}}}');
  const chosen = client.pick(client.detect({ cwd: dir, home: dir, platform: 'darwin' }));
  assert.equal(chosen.id, 'openclaw');
  assert.equal(chosen.file, oc);
});

test('pick refuses to select a config that does not parse', () => {
  const dir = scratch();
  const oc = path.join(dir, '.openclaw', 'openclaw.json');
  fs.mkdirSync(path.dirname(oc), { recursive: true });
  fs.writeFileSync(oc, '{ broken');
  assert.equal(client.pick(client.detect({ cwd: dir, home: dir, platform: 'darwin' })), null);
});

test('mergeServer adds, is idempotent, and updates in place', () => {
  const entry = { command: 'npx', args: ['-y', 'datum-mcp-server'], env: { DATUM_RPC_URL: 'x' } };
  const o = { mcp: { servers: {} } };
  assert.equal(client.mergeServer(o, ['mcp', 'servers'], 'datum', entry).action, 'added');
  assert.deepEqual(o.mcp.servers.datum, entry);

  assert.equal(client.mergeServer(o, ['mcp', 'servers'], 'datum', entry).action, 'unchanged');

  const next = { command: 'npx', args: ['-y', 'datum-mcp-server'], env: { DATUM_RPC_URL: 'y' } };
  assert.equal(client.mergeServer(o, ['mcp', 'servers'], 'datum', next).action, 'updated');
  assert.equal(o.mcp.servers.datum.env.DATUM_RPC_URL, 'y');
});

test('mergeServer never clobbers a non-object key', () => {
  const o = { mcp: { servers: 'oops' } };
  const r = client.mergeServer(o, ['mcp', 'servers'], 'datum', {});
  assert.equal(r.action, 'error');
  assert.match(r.error, /not an object/);
  assert.equal(o.mcp.servers, 'oops', 'left exactly as found');
});

test('planConfig preserves every other key and reports errors instead of guessing', () => {
  const dir = scratch();
  const file = path.join(dir, 'openclaw.json');
  fs.writeFileSync(file, JSON.stringify({ agent: { name: 'x' }, mcp: { servers: { other: { command: 'keep' } } } }));

  const entry = client.serverEntry({ key: FAKE_KEY, cap: 250 });
  const plan = client.planConfig(file, ['mcp', 'servers'], 'datum', entry);
  assert.equal(plan.action, 'added');
  const parsed = JSON.parse(plan.content);
  assert.deepEqual(parsed.agent, { name: 'x' });
  assert.deepEqual(parsed.mcp.servers.other, { command: 'keep' });
  assert.equal(parsed.mcp.servers.datum.env.DATUM_SIGNER_KEY, FAKE_KEY);
  assert.equal(parsed.mcp.servers.datum.env.DATUM_MAX_PRICE_DTM, '250');

  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, 'nonsense');
  const err = client.planConfig(bad, ['mcpServers'], 'datum', entry);
  assert.equal(err.action, 'error');
  assert.match(err.error, /not valid JSON/);
  assert.equal(err.content, undefined, 'no content is produced for a refusal');
});

test('serverEntry omits the key when none is supplied, and never invents one', () => {
  const withKey = client.serverEntry({ key: FAKE_KEY, cap: 10 });
  assert.equal(withKey.env.DATUM_SIGNER_KEY, FAKE_KEY);
  const noKey = client.serverEntry({ cap: 10 });
  assert.equal('DATUM_SIGNER_KEY' in noKey.env, false);
  assert.equal(noKey.env.DATUM_RPC_URL, client.DEFAULT_RPC);
  assert.equal(noKey.command, 'npx');
});

test('existingKey finds a stored key so a re-run never drops it', () => {
  const dir = scratch();
  const file = path.join(dir, 'openclaw.json');
  fs.writeFileSync(file, JSON.stringify({ mcp: { servers: { datum: { env: { DATUM_SIGNER_KEY: FAKE_KEY } } } } }));
  assert.equal(client.existingKey(file, ['mcp', 'servers'], 'datum'), FAKE_KEY);
  assert.equal(client.existingKey(file, ['mcpServers'], 'datum'), null);
  assert.equal(client.existingKey(path.join(dir, 'missing.json'), ['mcp', 'servers'], 'datum'), null);
});

test('pasteBlock carries a placeholder, never a real key', () => {
  const block = client.pasteBlock({ cap: 1000 });
  assert.ok(block.includes('REPLACE_WITH_YOUR_KEY'));
  assert.ok(!/0x[0-9a-fA-F]{64}/.test(block), 'no key-shaped string in the paste block');
  const parsed = JSON.parse(block);
  assert.equal(parsed.mcpServers.datum.command, 'npx');
  assert.deepEqual(parsed.mcpServers.datum.args, ['-y', 'datum-mcp-server']);
});
