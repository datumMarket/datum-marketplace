// Word-based search for listings and requests.
//
// The previous matcher tested the ENTIRE query string as one literal substring
// against title and description (`LIKE '%q%'`), so any multi-word query returned
// nothing even when a matching row was on the shelf.
//
// Observed in the field (2026-09-18): an agent searched "Kestrel Ridge KR-04
// September rainfall history" against a listing titled "Kestrel Ridge (KR-04)
// daily rainfall archive, 2016-2025" and got zero results — three different
// natural phrasings, all zero — then correctly concluded the market was empty
// and did the work itself. A control query of "KR-04" returned the row instantly.
//
// Now the query is split into words; a row matches when it contains ANY of them,
// and results are ordered by how many of the words they match.

const STOPWORDS = new Set([
  'a', 'about', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at', 'be',
  'been', 'but', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from',
  'get', 'got', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'me', 'much', 'my', 'need', 'no', 'not', 'of', 'on', 'or',
  'our', 'out', 'over', 'per', 'should', 'so', 'some', 'than', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to',
  'under', 'up', 'us', 'want', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

function tokenize(query) {
  return String(query == null ? '' : query)
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Build the text filter and the relevance ordering for one query.
//
//   null            -> no query at all; caller applies no text filter
//   { noMatch:true} -> query had no usable words; caller should return nothing
//   otherwise       -> { whereSql, whereParams, scoreSql, scoreParams }
//
// Params are returned in SQL binding order: whereParams belong to the WHERE
// fragment, scoreParams to the ORDER BY fragment that follows it.
function buildSearch(query, columns) {
  const raw = String(query == null ? '' : query).trim();
  if (!raw) return null;

  const tokens = tokenize(raw);
  if (!tokens.length) return { noMatch: true };

  const oneToken = '(' + columns.map((c) => `${c} LIKE ?`).join(' OR ') + ')';
  const params = [];
  for (const t of tokens) {
    for (let i = 0; i < columns.length; i += 1) params.push(`%${t}%`);
  }

  return {
    tokens,
    whereSql: tokens.map(() => oneToken).join(' OR '),
    whereParams: params,
    scoreSql: tokens.map(() => `(CASE WHEN ${oneToken} THEN 1 ELSE 0 END)`).join(' + '),
    scoreParams: params.slice(),
  };
}

module.exports = { buildSearch, tokenize };
