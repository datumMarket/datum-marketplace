'use strict';
// Marker-based, idempotent merge of the Datum every-task policy into an agent
// instruction file (AGENTS.md / CLAUDE.md).
//
// Pure functions only — no filesystem access lives here, so the logic is
// unit-testable and the write path in onboard.js stays small and auditable.
//
// Guarantees:
//   * Existing content is never discarded; the block is inserted or replaced.
//   * Re-running with the same block produces byte-identical output.
//   * Unbalanced markers are treated as a hard error — we refuse rather than
//     guess, because a half-matched marker means someone hand-edited the file.

const BEGIN = '<!-- datum:policy:begin -->';
const END = '<!-- datum:policy:end -->';

/** Wrap the block body in the idempotency markers (no trailing newline). */
function renderBlock(blockText) {
  return `${BEGIN}\n${String(blockText).trim()}\n${END}`;
}

/**
 * Merge the policy block into `existing` text.
 * @returns {{action:'added'|'updated'|'unchanged'|'error', content?:string, error?:string}}
 */
function mergePolicy(existing, blockText) {
  const text = typeof existing === 'string' ? existing : '';
  const block = renderBlock(blockText);

  const i = text.indexOf(BEGIN);
  const j = text.indexOf(END);

  if (i !== -1 && j !== -1 && j > i) {
    const before = text.slice(0, i);
    const after = text.slice(j + END.length).replace(/^\n+/, '');
    let content = before + block;
    content += after ? '\n\n' + after : '\n';
    return { action: content === text ? 'unchanged' : 'updated', content };
  }

  if (i !== -1 || j !== -1) {
    return {
      action: 'error',
      error: 'policy markers are unbalanced (begin/end mismatch) — refusing to edit',
    };
  }

  if (text === '') return { action: 'added', content: block + '\n' };

  const base = text.replace(/\n+$/, '');
  return { action: 'added', content: base + '\n\n' + block + '\n' };
}

/** True when the text already carries the current block. */
function hasPolicy(text, blockText) {
  if (typeof text !== 'string') return false;
  const i = text.indexOf(BEGIN);
  const j = text.indexOf(END);
  if (i === -1 || j === -1 || j <= i) return false;
  return text.slice(i, j + END.length) === renderBlock(blockText);
}

module.exports = { BEGIN, END, renderBlock, mergePolicy, hasPolicy };
