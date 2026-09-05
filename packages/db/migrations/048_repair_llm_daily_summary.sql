-- Migration 048: repair the corrupted __daily_summary__ rollup series.
--
-- THE BUG
-- /api/cron/llm-stats aggregates "yesterday's" llm_call_log rows and inserts a
-- single __daily_summary__ row holding the day's totals. Its source query did
-- not exclude __daily_summary__ — and the previous day's summary row was
-- itself written inside that window. So every day's summary silently contained
-- the day before's:
--
--     S(n) = R(n) + S(n-1)
--
-- which is a running cumulative total, not a daily one. The series only ever
-- increased (23k prompt tokens on 2026-05-16 → 1.38M by 2026-06-24), and a
-- naive 30-day SUM over the table read ~$184 against ~$2.81 of real spend —
-- 98.5% of apparent cost was one row type double-counting itself.
--
-- The code fix is in the same commit (llm-stats/route.js now filters on
-- DAILY_SUMMARY_ROUTE). This migration repairs the history the bug produced.
--
-- SAFETY
-- The real per-call rows were never affected — they cover 2026-05-15 onward
-- with no gaps, so every summary is exactly recomputable from them. The old
-- values are copied to llm_call_log_summary_backup first, so this is
-- reversible; drop that table once the dashboards look right.

begin;

-- 1. Back up the corrupt rows before touching them.
create table if not exists llm_call_log_summary_backup as
  select * from llm_call_log where route = '__daily_summary__';

-- 2. Drop them.
delete from llm_call_log where route = '__daily_summary__';

-- 3. Rebuild one honest summary per day from the real call rows.
--    created_at is set to 06:00 UTC the following day, matching where the cron
--    would have written it, so the existing dashboard series keeps its shape.
insert into llm_call_log (route, model, ok, prompt_tokens, completion_tokens, total_cost_usd, created_at)
select
  '__daily_summary__',
  'summary',
  true,
  sum(coalesce(prompt_tokens, 0)),
  sum(coalesce(completion_tokens, 0)),
  sum(coalesce(total_cost_usd, 0)),
  (created_at::date + 1) + time '06:00'
from llm_call_log
where route <> '__daily_summary__'
group by created_at::date
order by created_at::date;

commit;

-- Sanity check (run manually; a correct series fluctuates instead of climbing):
--   select created_at::date, prompt_tokens, total_cost_usd
--     from llm_call_log where route = '__daily_summary__' order by created_at;
