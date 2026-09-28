'use strict';
// Tests for the onboarding merge logic (pure functions, no network, no writes).
// Run: npm test   (from mcp/)   — or: node --test test/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { mergePolicy, hasPolicy, renderBlock, BEGIN, END } = require('../onboard/merge');
const { candidates, inspect, detect } = require('../onboard/detect');

const BLOCK = '## Datum Marketplace — every-task policy\n\n1. list it.';

test('adds the block to a new file', () => {
  const r = mergePolicy('', BLOCK);
  assert.equal(r.action, 'added');
  assert.ok(r.content.startsWith(BEGIN));
  assert.ok(r.content.trimEnd().endsWith(END));
});

test('preserves existing content when adding', () => {
  const before = '# My Agent\n\nAlways be helpful.\n';
  const r = mergePolicy(before, BLOCK);
  assert.equal(r.action, 'added');
  assert.ok(r.content.startsWith('# My Agent'));
  assert.ok(r.content.includes('Always be helpful.'));
  assert.ok(r.content.includes(BEGIN));
});

test('is idempotent — a second run changes nothing', () => {
  const first = mergePolicy('# My Agent\n', BLOCK);
  const second = mergePolicy(first.content, BLOCK);
  assert.equal(second.action, 'unchanged');
  assert.equal(second.content, first.content);
  const third = mergePolicy(second.content, BLOCK);
  assert.equal(third.action, 'unchanged');
  assert.equal(third.content, first.content);
});

test('updates the block in place when the policy text changes', () => {
  const first = mergePolicy('# My Agent\n\nnotes\n', BLOCK);
  const second = mergePolicy(first.content, BLOCK + '\n\n2. search first.');
  assert.equal(second.action, 'updated');
  assert.ok(second.content.includes('2. search first.'));
  assert.ok(second.content.startsWith('# My Agent'));
  assert.ok(second.content.includes('notes'));
  assert.equal(second.content.match(new RegExp(BEGIN, 'g')).length, 1);
});

test('refuses to edit when markers are unbalanced', () => {
  const broken = `# notes\n\n${BEGIN}\nblock without end\n`;
  const r = mergePolicy(broken, BLOCK);
  assert.equal(r.action, 'error');
  assert.match(r.error, /unbalanced/);
  assert.equal(hasPolicy(broken, BLOCK), false);
});

test('renderBlock wraps body in markers', () => {
  const out = renderBlock('  body  ');
  assert.equal(out, `${BEGIN}\nbody\n${END}`);
});

test('detect lists candidates and reports missing files safely', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'datum-onboard-'));
  const list = detect({ cwd: dir, home: dir });
  assert.ok(Array.isArray(list) && list.length >= 3);
  for (const c of list) assert.equal(typeof c.file, 'string');
  const missing = list.find((c) => !c.exists);
  assert.ok(missing, 'expected at least one missing candidate in a temp home');
  assert.equal(missing.isFile, false);

  const target = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(target, 'hello\n');
  const state = inspect(target);
  assert.equal(state.exists, true);
  assert.equal(state.isFile, true);
  assert.equal(state.size, 6);
});

test('never targets a credential file', () => {
  // assertSafeTarget lives in onboard.js; this asserts the documented rule holds
  // for the detection layer too — candidates are instruction files only.
  const list = candidates({ cwd: '/tmp', home: '/tmp' });
  for (const c of list) {
    assert.ok(!/\.env|\.key$|\.pem$/.test(c.file), `unsafe candidate: ${c.file}`);
  }
});
