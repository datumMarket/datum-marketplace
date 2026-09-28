'use strict';
// Locate the instruction file an agent actually reads, across common runtimes.
//
// Order matters: the first existing, writable candidate is the default target.
// OpenClaw loads exactly one workspace-root AGENTS.md (verified empirically —
// a working-directory AGENTS.md is NOT read), so it leads the list. Claude Code
// reads CLAUDE.md from the project root. Plain AGENTS.md covers other clients.

const fs = require('fs');
const os = require('os');
const path = require('path');

function candidates({ cwd = process.cwd(), home = os.homedir() } = {}) {
  return [
    { id: 'openclaw', label: 'OpenClaw workspace', file: path.join(home, '.openclaw', 'workspace', 'AGENTS.md') },
    { id: 'claude', label: 'Claude Code (project)', file: path.join(cwd, 'CLAUDE.md') },
    { id: 'agents', label: 'Project AGENTS.md', file: path.join(cwd, 'AGENTS.md') },
    { id: 'home-agents', label: 'Home AGENTS.md', file: path.join(home, 'AGENTS.md') },
  ];
}

function inspect(file) {
  const out = { exists: false, isFile: false, size: 0, symlink: false, writable: false };
  try {
    const lst = fs.lstatSync(file);
    out.symlink = lst.isSymbolicLink();
    const st = out.symlink ? fs.statSync(file) : lst;
    out.isFile = st.isFile();
    out.size = st.size;
    out.exists = true;
  } catch {
    out.exists = false;
  }
  try {
    if (out.exists) fs.accessSync(file, fs.constants.W_OK);
    else fs.accessSync(path.dirname(file), fs.constants.W_OK);
    out.writable = true;
  } catch {
    out.writable = false;
  }
  return out;
}

function detect(opts) {
  return candidates(opts).map((c) => Object.assign({}, c, inspect(c.file)));
}

module.exports = { candidates, inspect, detect };
