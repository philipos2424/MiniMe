/**
 * fetchAllRows — drain a PostgREST query past the server-side row cap.
 *
 * Supabase caps every response at `max-rows` (1000 by default) no matter how
 * large a .limit() the client asks for. Any route that fetches raw rows and
 * aggregates in JS silently undercounts once a window exceeds that cap —
 * this was making every admin stat (trends, GMV, funnel, unit economics,
 * API costs) wrong past ~1000 rows. Always page with .range() instead.
 *
 * `makeQuery` must return a FRESH query builder each call (builders are
 * mutable, so they can't be reused across pages) and must include a stable
 * .order() so pages don't overlap.
 *
 * Dependency-free on purpose: testable with plain `node` (see
 * tests/fetch-all.test.mjs).
 */
export async function fetchAllRows(makeQuery, { pageSize = 1000, maxRows = 200000 } = {}) {
  const rows = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await makeQuery().range(from, to);
    if (error) return { data: rows, error };
    rows.push(...(data || []));
    if (!data || data.length < to - from + 1) break; // short page = no more rows
  }
  return { data: rows, error: null };
}

// ── Batched `.in(column, ids)` queries ───────────────────────────────────────
// A `.in()` filter serializes every id into the request URL. At a few
// hundred+ ids that string blows past what PostgREST/the proxy will accept
// and the query fails outright (400 Bad Request) — silently, if the caller
// doesn't check `error`, which is exactly how this bit us: a cron's cooldown
// lookup filtered by `.in('business_id', ids)` across ~900 businesses failed
// on every run and nobody noticed, because cooldowns still "worked" (they
// just always resolved to "no prior sends").
//
// Chunk the id list and run one paginated fetchAllRows() per chunk, well
// under any URL-length limit.
const ID_BATCH_SIZE = 150;

/**
 * `makeQuery(idsBatch)` must return a FRESH query builder for that batch
 * (same constraint as fetchAllRows — builders are mutable) with a stable
 * .order() so each batch's pages don't overlap.
 */
export async function fetchAllRowsForIds(ids, makeQuery, opts) {
  const rows = [];
  for (let i = 0; i < ids.length; i += ID_BATCH_SIZE) {
    const batch = ids.slice(i, i + ID_BATCH_SIZE);
    const { data, error } = await fetchAllRows(() => makeQuery(batch), opts);
    if (error) return { data: rows, error };
    rows.push(...(data || []));
  }
  return { data: rows, error: null };
}

// ── Day bucketing in East Africa Time ────────────────────────────────────────
// The platform's merchants are Ethiopian (UTC+3, no DST). Bucketing by UTC
// put every evening message (9pm–midnight EAT) on the previous day, so the
// daily charts never matched what owners actually saw. Shift by +3h before
// slicing the date.
const EAT_OFFSET_MS = 3 * 3600 * 1000;

export function dayKeyEAT(isoOrDate) {
  const t = isoOrDate instanceof Date ? isoOrDate.getTime() : new Date(isoOrDate).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + EAT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Last n day keys in EAT, oldest first, ending today. */
export function lastNDaysEAT(n, now = Date.now()) {
  return Array.from({ length: n }, (_, i) => dayKeyEAT(now - (n - 1 - i) * 86400000));
}
