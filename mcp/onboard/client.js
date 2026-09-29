'use strict';
// Locate the MCP client config file an operator's agent reads, and merge
// Datum's server entry into it without disturbing anything else.
//
// Why write the config file directly instead of shelling out to
// `openclaw mcp add` / `claude mcp add`: those take the seller key as a
// command-line argument, where it is visible to `ps` for the life of the call
// and lands in shell history. A direct write keeps the key out of argv, out of
// history, and out of any log.
//
// Refusals over guesses: a config that does not parse, or whose target key is
// not an object, is reported as an error and never rewritten.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER_NAME = 'datum';
const DEFAULT_RPC = 'https://mainnet.base.org';
const SERVER_COMMAND = 'npx';
// The package ships three bins (datum-mcp, datum-keygen, datum-onboard), so
// `npx -y datum-mcp-server` fails with "could not determine executable to run"
// — the package name matches no bin. Name the bin explicitly.
const SERVER_ARGS = ['-y', '--package=datum-mcp-server', 'datum-mcp'];

function candidates({ cwd = process.cwd(), home = os.homedir(), platform = process.platform, env = process.env } = {}) {
  const list = [
    { id: 'openclaw', label: 'OpenClaw', file: path.join(home, '.openclaw', 'openclaw.json'), root: ['mcp', 'servers'] },
    { id: 'claude-code', label: 'Claude Code (project)', file: path.join(cwd, '.mcp.json'), root: ['mcpServers'] },
    { id: 'claude-code-user', label: 'Claude Code (user)', file: path.join(home, '.claude.json'), root: ['mcpServers'] },
  ];
  if (platform === 'darwin') {
    list.push({
      id: 'claude-desktop',
      label: 'Claude Desktop',
      file: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      root: ['mcpServers'],
    });
  } else if (platform === 'win32') {
    list.push({
      id: 'claude-desktop',
      label: 'Claude Desktop',
      file: path.join(env.APPDATA || home, 'Claude', 'claude_desktop_config.json'),
      root: ['mcpServers'],
    });
  } else {
    list.push({
      id: 'claude-desktop',
      label: 'Claude Desktop',
      file: path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
      root: ['mcpServers'],
    });
  }
  return list;
}

function inspect(file) {
  const out = { exists: false, isFile: false, bytes: 0, writable: false, valid: true, error: null };
  try {
    const st = fs.statSync(file);
    out.exists = true;
    out.isFile = st.isFile();
    out.bytes = st.size;
  } catch {
    out.exists = false;
  }
  try {
    if (out.exists) fs.accessSync(file, fs.constants.R_OK | fs.constants.W_OK);
    else fs.accessSync(path.dirname(file), fs.constants.W_OK);
    out.writable = true;
  } catch {
    out.writable = false;
  }
  if (out.exists && out.isFile) {
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      out.valid = false;
      out.error = 'existing config is not valid JSON — refusing to rewrite it';
    }
  }
  return out;
}

function detect(opts) {
  return candidates(opts).map((c) => Object.assign({}, c, inspect(c.file)));
}

/**
 * Choose a config to write. Only an existing, writable, parseable config is
 * ever selected — this tool never creates a client config from nothing, because
 * guessing a client's location is how you end up writing to the wrong file.
 */
function pick(cands, explicit) {
  if (explicit) {
    const file = path.resolve(explicit);
    const known = cands.find((c) => path.resolve(c.file) === file);
    const base = { id: 'explicit', label: 'explicit --client-config', file, root: ['mcpServers'] };
    return Object.assign(base, known ? { root: known.root } : {}, inspect(file));
  }
  return cands.find((c) => c.exists && c.isFile && c.writable && c.valid) || null;
}

/** The server entry written into the client config. */
function serverEntry({ key, rpc = DEFAULT_RPC, cap } = {}) {
  const env = { DATUM_RPC_URL: rpc };
  if (cap !== undefined && cap !== null && cap !== '') env.DATUM_MAX_PRICE_DTM = String(cap);
  if (key) env.DATUM_SIGNER_KEY = key;
  return { command: SERVER_COMMAND, args: SERVER_ARGS.slice(), env };
}

/**
 * Merge `entry` under `root`/`name`, mutating `parsed`.
 * @returns {{action:'added'|'updated'|'unchanged'|'error', error?:string}}
 */
function mergeServer(parsed, root, name, entry) {
  let node = parsed;
  for (const k of root) {
    if (node[k] === undefined) node[k] = {};
    if (typeof node[k] !== 'object' || node[k] === null || Array.isArray(node[k])) {
      return { action: 'error', error: `config key "${k}" is not an object — refusing to overwrite it` };
    }
    node = node[k];
  }
  if (node[name] && JSON.stringify(node[name]) === JSON.stringify(entry)) return { action: 'unchanged' };
  const action = node[name] ? 'updated' : 'added';
  node[name] = entry;
  return { action };
}

/**
 * Compute the new file content without touching the filesystem.
 * @returns {{action:string, content?:string, error?:string}}
 */
function planConfig(file, root, name, entry) {
  let parsed = {};
  if (fs.existsSync(file)) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      return { action: 'error', error: `cannot read config: ${e.message}` };
    }
    if (raw.trim() !== '') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { action: 'error', error: 'existing config is not valid JSON — refusing to rewrite it' };
      }
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { action: 'error', error: 'config root is not a JSON object — refusing to rewrite it' };
  }
  const merged = mergeServer(parsed, root, name, entry);
  if (merged.action === 'error') return merged;
  return { action: merged.action, content: JSON.stringify(parsed, null, 2) + '\n' };
}

/** The seller key already present in a config, so a re-run never drops it. */
function existingKey(file, root, name) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    let node = parsed;
    for (const k of root) {
      node = node ? node[k] : null;
      if (!node) return null;
    }
    const entry = node[name];
    return (entry && entry.env && entry.env.DATUM_SIGNER_KEY) || null;
  } catch {
    return null;
  }
}

/** Ready-to-paste block for clients we cannot write directly (key left blank). */
function pasteBlock({ cap } = {}) {
  const env = { DATUM_SIGNER_KEY: 'REPLACE_WITH_YOUR_KEY', DATUM_RPC_URL: DEFAULT_RPC };
  if (cap !== undefined && cap !== null && cap !== '') env.DATUM_MAX_PRICE_DTM = String(cap);
  const body = { mcpServers: {} };
  body.mcpServers[SERVER_NAME] = { command: SERVER_COMMAND, args: SERVER_ARGS.slice(), env };
  return JSON.stringify(body, null, 2);
}

module.exports = {
  SERVER_NAME,
  DEFAULT_RPC,
  candidates,
  inspect,
  detect,
  pick,
  serverEntry,
  mergeServer,
  planConfig,
  existingKey,
  pasteBlock,
};
