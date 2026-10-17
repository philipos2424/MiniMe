/**
 * llmCallLog — the single writer for `llm_call_log`, plus the helpers that
 * decide what a row is called.
 *
 * Split out of openai-wrapper.js because there are TWO paths that reach a
 * provider, and until now only one of them logged:
 *
 *   loggedCompletion()  (openai-wrapper.js) — 28 call sites, always logged
 *   makeOpenAI()        (openaiClient.js)   — 42 call sites, logged nothing
 *
 * The unlogged path carried the expensive traffic: agentBrain/teamBrain run a
 * tool-calling loop and opt out of the app-wide reasoning_effort:'none'
 * default, so they pay for hidden reasoning tokens at output rates — the
 * single biggest cost lever in the system (see constants.js). Cost review
 * against llm_call_log was therefore reading roughly 40% of the bill and
 * calling it the whole thing.
 *
 * Living in its own .mjs module keeps it importable from BOTH sides without a
 * cycle (openai-wrapper.js already imports openaiClient.js, so the logger
 * cannot live in either one), and testable under plain `node --test`.
 *
 * NOTE: db is loaded with a LAZY dynamic import, not a static one. openaiClient.js
 * imports this module, and openaiClient.js is loaded directly by node:test
 * (proModelGate.test.mjs) — a static `import ... from './db'` is extensionless,
 * resolves only under the Next bundler, and takes that whole suite down with
 * ERR_MODULE_NOT_FOUND. The dynamic import runs only when a call is actually
 * logged, which never happens under test.
 */

/**
 * The rollup row written daily by /api/cron/llm-stats. It is NOT an API call,
 * and it holds a whole day's totals — so every query that sums, averages, or
 * ranks real traffic MUST exclude it.
 *
 * Exported as a constant because it was previously a string literal repeated
 * across six files, and the one place that forgot it (the cron's own source
 * query) made each day's summary include the day before's, turning the series
 * into a running cumulative total that read ~80x real spend.
 */
export const DAILY_SUMMARY_ROUTE = '__daily_summary__';

/**
 * Best-effort label for a call that reached a provider without naming itself.
 *
 * Deliberately coarse: the file that called is enough to find the spend, and
 * a stack walk is not something to be clever in. Anything unexpected returns
 * the generic label rather than throwing — a wrong label loses a little
 * attribution, a throw loses the call.
 */
export function inferRoute(stack) {
  try {
    const lines = String(stack || '').split('\n').slice(1);
    for (const line of lines) {
      // Skip the plumbing: the logger, the client wrapper, and node internals.
      if (/llmCallLog|openaiClient|openai-wrapper|node_modules|node:internal/.test(line)) continue;
      const m = line.match(/([A-Za-z0-9_.-]+)\.(?:m?js|jsx|ts|tsx)/);
      if (m) return `raw:${m[1]}`;
    }
  } catch {}
  return 'raw:unknown';
}

/**
 * Insert one row into llm_call_log. Fire-and-forget — logging must never block
 * or fail a reply.
 *
 * cached_tokens / reasoning_tokens arrive with the token-details migration
 * (supabase/migrations/llm_call_log_token_details.sql). If that hasn't been
 * applied, the insert fails on the unknown columns — and because this is
 * fire-and-forget, it would take ALL cost logging down silently. So retry once
 * without them rather than losing the row.
 */
export function logCall(row) {
  const { cached_tokens, reasoning_tokens, ...base } = row;
  // Explicit .js extension: this path is resolved by node at runtime, not only
  // by the Next bundler. See the NOTE at the top of this file.
  import('./db.js').then(({ supabase }) => {
    const sb = supabase();
    if (!sb) return;
    return sb.from('llm_call_log').insert(row).then(({ error }) => {
      if (error) return sb.from('llm_call_log').insert(base);
    });
  }).catch(() => {
    // Logging must never block or fail a reply.
  });
}
