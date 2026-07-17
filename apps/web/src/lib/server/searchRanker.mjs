/**
 * searchRanker — relevance scoring for MiniMe Search.
 *
 * Fuses candidates from three retrievers (keyword/profile SQL, product SQL,
 * pgvector semantic) into one ranked list using a transparent weighted score.
 * Pure and dependency-free so it can be unit-tested and tuned in one place.
 *
 * Every candidate is a business row that may carry annotations:
 *   _matched_product : { name, price, _inBudget } from the product retriever
 *   _similarity      : cosine similarity (0..1) from the semantic retriever
 *
 * The score is a weighted blend of four normalized sub-scores:
 *   keyword  — how well the query terms hit the profile (field-weighted)
 *   semantic — embedding similarity (meaning match; catches typos / Amharic)
 *   product  — a concrete product matched (and fits budget)
 *   quality  — verified / rating / popularity, DEMOTED to a small tiebreak so
 *              a well-reviewed shop can't outrank a genuinely better match.
 */

export const RANK_WEIGHTS = { keyword: 0.40, semantic: 0.30, product: 0.22, quality: 0.08 };

// Which profile field a keyword hit is worth. A name hit means far more than a
// buried description hit.
const FIELD_WEIGHTS = { name: 1.0, tagline: 0.85, tags: 0.7, category: 0.5, description: 0.45 };

// Semantic similarity floor/ceiling for normalization. Below ~0.15 the RPC
// wouldn't have returned the row; ~0.75+ is a very strong meaning match.
const SEM_LO = 0.15;
const SEM_HI = 0.75;

// Geʽez (Amharic) script block.
const GEEZ = /[ሀ-፿]/;

/**
 * Match a keyword inside profile text.
 *
 * Latin: whole-word-ish — the keyword must sit on a word boundary (optionally
 * with a trailing plural), so "car" no longer matches "carpet"/"scarf" the way
 * a bare substring `includes` did.
 *
 * Amharic: substring match. Geʽez is agglutinative — prefixes like የ/በ/ከ attach
 * directly to the noun (የመኪና = "of the car"), so a word boundary would miss the
 * root. Substring is the correct primitive there.
 */
export function wordMatch(haystack, keyword) {
  if (!haystack || !keyword) return false;
  if (GEEZ.test(keyword)) return haystack.includes(keyword);
  const esc = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(s|es)?([^\\p{L}\\p{N}]|$)`, 'iu');
    return re.test(haystack);
  } catch {
    return haystack.toLowerCase().includes(keyword.toLowerCase());
  }
}

/** Keyword sub-score (0..1) plus which fields matched (for logging / cards). */
export function keywordScore(row, keywords) {
  const kws = (keywords || []).map(k => String(k).toLowerCase().trim()).filter(Boolean);
  if (!kws.length) return { score: 0, fields: [] };
  const fields = {
    name: row.name || '',
    tagline: row.tagline || '',
    tags: Array.isArray(row.tags) ? row.tags.join(' ') : '',
    category: row.category || '',
    description: row.description || '',
  };
  let sum = 0;
  const matched = new Set();
  for (const kw of kws) {
    let best = 0;
    for (const [field, text] of Object.entries(fields)) {
      if (wordMatch(text, kw)) {
        if (FIELD_WEIGHTS[field] > best) best = FIELD_WEIGHTS[field];
        matched.add(field);
      }
    }
    sum += best;
  }
  return { score: Math.min(1, sum / kws.length), fields: [...matched] };
}

/** Semantic sub-score (0..1) from raw cosine similarity. */
export function semanticScore(similarity) {
  if (similarity == null) return 0;
  return Math.max(0, Math.min(1, (similarity - SEM_LO) / (SEM_HI - SEM_LO)));
}

/** Product sub-score: a concrete matched product is a strong intent signal. */
export function productScore(row) {
  const m = row._matched_product;
  if (!m) return 0;
  return m._inBudget === false ? 0.6 : 1.0;
}

/** Quality prior (0..1): verified + rating + log-scaled popularity. */
export function qualityScore(row, maxSearchCount = 0) {
  let s = 0;
  if (row.verified) s += 0.5;
  const rating = Number(row.average_rating) || 0;
  if ((row.total_reviews || 0) > 0) s += (rating / 5) * 0.3;
  if (maxSearchCount > 0) {
    s += Math.min(1, Math.log1p(row.search_count || 0) / Math.log1p(maxSearchCount)) * 0.2;
  }
  return Math.min(1, s);
}

/** Full score for one candidate. Returns score + parts for transparency. */
export function scoreCandidate(row, { keywords = [], maxSearchCount = 0, weights = RANK_WEIGHTS } = {}) {
  const kw = keywordScore(row, keywords);
  const parts = {
    keyword: kw.score,
    semantic: semanticScore(row._similarity),
    product: productScore(row),
    quality: qualityScore(row, maxSearchCount),
  };
  const score =
    weights.keyword * parts.keyword +
    weights.semantic * parts.semantic +
    weights.product * parts.product +
    weights.quality * parts.quality;
  return { score, parts, matchedFields: kw.fields };
}

/** A candidate is "relevant" if any signal OTHER than the quality prior fired. */
export function isRelevant(row) {
  const p = row._scoreParts;
  if (!p) return false;
  return (p.keyword + p.semantic + p.product) > 0;
}

/**
 * Dedupe (merging annotations), apply category discipline, score, and sort.
 * Returns the full ranked list; the caller pages it.
 */
export function rankCandidates(rows, { keywords = [], category = null, weights = RANK_WEIGHTS } = {}) {
  const byId = new Map();
  for (const r of rows) {
    if (!r?.id) continue;
    const prev = byId.get(r.id);
    if (!prev) { byId.set(r.id, { ...r }); continue; }
    byId.set(r.id, {
      ...prev,
      ...r,
      // Keep the strongest annotation from either source.
      _matched_product: prev._matched_product || r._matched_product,
      _similarity: prev._similarity ?? r._similarity,
    });
  }

  let cands = [...byId.values()];

  // Category discipline: when the query's category is known, embeddings and
  // fuzzy matches must not smuggle in cross-category shops. Uncategorized rows
  // stay eligible.
  if (category) {
    const want = String(category).toLowerCase();
    cands = cands.filter(b => {
      if (!b.category) return true;
      if (String(b.category).toLowerCase() === want) return true;
      return Array.isArray(b.categories)
        && b.categories.some(c => String(c).toLowerCase() === want);
    });
  }

  const maxSearchCount = cands.reduce((m, b) => Math.max(m, b.search_count || 0), 0);
  for (const b of cands) {
    const s = scoreCandidate(b, { keywords, maxSearchCount, weights });
    b._score = s.score;
    b._scoreParts = s.parts;
    b._matchedFields = s.matchedFields;
  }

  cands.sort((a, b) =>
    b._score - a._score ||
    (b.verified ? 1 : 0) - (a.verified ? 1 : 0) ||
    (Number(b.average_rating) || 0) - (Number(a.average_rating) || 0) ||
    (b.search_count || 0) - (a.search_count || 0),
  );
  return cands;
}
