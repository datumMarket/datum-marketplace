// Regression coverage for the search matcher.
//
// The bug this file exists to prevent: the matcher compared the ENTIRE query as
// one literal substring against title and description, so a natural multi-word
// question returned nothing even when a matching listing was on the shelf. It
// was observed in the field — three phrasings of the same real question, all
// zero results, while a control query of "KR-04" returned the row instantly.
//
// The final block runs the generated SQL against a real in-memory SQLite
// database. That matters: a builder can produce plausible-looking SQL strings
// with the wrong parameter order and still pass every string-level assertion
// above it. Only executing it catches that.

const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const { buildSearch, tokenize } = require('../server/src/search');

const COLUMNS = ['title', 'description'];

// The listing that was live in the market when the bug was found.
const KR04 = {
  title: 'Kestrel Ridge (KR-04) daily rainfall archive, 2016-2025',
  description:
    'The complete daily rainfall record for the site, 2016-01-01 to 2025-12-31, in millimetres.',
};

function makeDb(rows) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE listings (id INTEGER PRIMARY KEY, title TEXT, description TEXT)');
  const ins = db.prepare('INSERT INTO listings (id, title, description) VALUES (?,?,?)');
  rows.forEach((r, i) => ins.run(i + 1, r.title, r.description || ''));
  return db;
}

// Mirror exactly how the routes build and bind their statement, so this test
// fails if the routes and the matcher ever disagree about ordering.
function idsFor(db, query) {
  const s = buildSearch(query, COLUMNS);
  if (!s) return db.prepare('SELECT id FROM listings ORDER BY id').all().map((r) => r.id);
  if (s.noMatch) return [];
  const sql =
    'SELECT id FROM listings WHERE ' + s.whereSql +
    ' ORDER BY ' + s.scoreSql + ' DESC, id LIMIT 20';
  return db.prepare(sql).all(...s.whereParams, ...s.scoreParams).map((r) => r.id);
}

describe('search — query handling', () => {
  it('returns null when there is no query at all', () => {
    assert.strictEqual(buildSearch('', COLUMNS), null);
    assert.strictEqual(buildSearch(null, COLUMNS), null);
    assert.strictEqual(buildSearch('   ', COLUMNS), null);
  });

  it('reports noMatch when a query has no usable words', () => {
    assert.strictEqual(buildSearch('the and of to', COLUMNS).noMatch, true);
  });

  it('drops stopwords and single characters', () => {
    assert.deepStrictEqual(tokenize('the rainfall a of in'), ['rainfall']);
  });

  it('splits a natural-language question into searchable words', () => {
    const r = buildSearch('Kestrel Ridge KR-04 September rainfall history', COLUMNS);
    assert.ok(r.tokens.includes('kestrel'));
    assert.ok(r.tokens.includes('ridge'));
    assert.ok(r.tokens.includes('rainfall'));
    assert.ok(r.tokens.includes('kr-04'));
    assert.ok(!r.tokens.includes('the'));
  });

  it('binds one parameter per token per column, in matching order', () => {
    const r = buildSearch('ridge rainfall', COLUMNS);
    assert.strictEqual(r.whereParams.length, 2 * COLUMNS.length);
    assert.strictEqual(r.scoreParams.length, 2 * COLUMNS.length);
    assert.deepStrictEqual(r.scoreParams, r.whereParams);
  });
});

describe('search — the reported regression', () => {
  it('finds a listing with a multi-word natural question (the original failure)', () => {
    const db = makeDb([KR04]);
    // The exact query that returned nothing before the fix.
    assert.deepStrictEqual(
      idsFor(db, 'Kestrel Ridge KR-04 September rainfall history'),
      [1]
    );
  });

  it('finds it from several different phrasings', () => {
    const db = makeDb([KR04]);
    const phrasings = [
      'September precipitation daily records orchard',
      'historical daily rainfall for this site',
      'how much rain fell in early September',
      'KR-04',
    ];
    for (const q of phrasings) {
      assert.deepStrictEqual(idsFor(db, q), [1], 'should match: ' + q);
    }
  });

  it('still returns nothing for a query that genuinely does not match', () => {
    const db = makeDb([KR04]);
    assert.deepStrictEqual(idsFor(db, 'zebra taxlaw blockchain'), []);
  });

  it('ranks the row matching more of the words first', () => {
    const db = makeDb([
      // matches "orchard" only
      { title: 'Orchard notes', description: 'drainage only, no measurements' },
      // matches both "orchard" and "rainfall"
      { title: 'Orchard rainfall archive', description: 'rainfall totals by month' },
    ]);
    const ids = idsFor(db, 'orchard rainfall');
    assert.strictEqual(ids.length, 2, 'both rows should match on at least one word');
    assert.strictEqual(ids[0], 2, 'the row matching two words should rank first');
  });

  it('matches case-insensitively', () => {
    const db = makeDb([KR04]);
    assert.deepStrictEqual(idsFor(db, 'KESTREL RIDGE'), [1]);
    assert.deepStrictEqual(idsFor(db, 'kestrel ridge'), [1]);
  });
});
