-- 060_metrics_rollup.sql — nightly admin rollups (spec 2026-10-13 §3.2).
-- Counts and states only; no personal data. shop_daily has no FK to
-- businesses on purpose: owner erasure re-keys rows to a random UUID so
-- platform totals survive while the link to the person is removed.

alter table public.businesses
  add column if not exists is_internal boolean not null default false;

create table if not exists public.shop_daily (
  business_id           uuid          not null,
  day                   date          not null,
  inbound_messages      int           not null default 0,
  outbound_messages     int           not null default 0,
  failed_messages       int           not null default 0,
  ai_messages           int           not null default 0,
  customers_active      int           not null default 0,
  customers_new         int           not null default 0,
  orders_created        int           not null default 0,
  orders_paid           int           not null default 0,
  paid_order_value_etb  numeric(14,2) not null default 0,
  first_reply_p50_s     int,
  owner_sessions        int           not null default 0,
  llm_calls             int           not null default 0,
  llm_failed            int           not null default 0,
  llm_cost_usd          numeric(12,6) not null default 0,
  ai_tokens             bigint        not null default 0,
  plan_state            text,
  payment_state         text,
  source                text          not null default 'cron' check (source in ('cron','backfill')),
  computed_at           timestamptz   not null default now(),
  primary key (business_id, day)
);
create index if not exists shop_daily_day_idx on public.shop_daily (day);

create table if not exists public.platform_daily (
  day                date          primary key,
  signups            int           not null default 0,
  live_shops         int           not null default 0,
  engaged_owners     int           not null default 0,
  inbound_messages   int           not null default 0,
  outbound_messages  int           not null default 0,
  failed_messages    int           not null default 0,
  orders_created     int           not null default 0,
  orders_paid        int           not null default 0,
  llm_calls          int           not null default 0,
  llm_failed         int           not null default 0,
  llm_cost_usd       numeric(12,6) not null default 0,
  trial_converted    int           not null default 0,
  subscribed         int           not null default 0,
  expired            int           not null default 0,
  funnel             jsonb         not null default '{}'::jsonb,
  source             text          not null default 'cron' check (source in ('cron','backfill')),
  computed_at        timestamptz   not null default now()
);

create table if not exists public.metrics_rollup_runs (
  id            bigserial   primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  days_from     date,
  days_to       date,
  shop_rows     int,
  platform_rows int,
  ok            boolean,
  error         text
);
create index if not exists metrics_rollup_runs_started_idx on public.metrics_rollup_runs (started_at desc);

-- Service role only (it bypasses RLS); no anon/authenticated access.
alter table public.shop_daily          enable row level security;
alter table public.platform_daily      enable row level security;
alter table public.metrics_rollup_runs enable row level security;
