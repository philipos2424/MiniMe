-- 067_funnel_events.sql — shop lifecycle funnel (pricing & funnel spec §1).
--
-- One row per shop milestone, so "how many shops moved through each step?"
-- has a single source. Rows are derived from tables that already exist
-- (businesses, messages, subscription_events, payment_verifications) by
-- lib/server/funnel/derive.mjs; the unique key makes every sync and the
-- backfill idempotent.
--
-- Counts and states only. metadata never holds names, phones, telegram ids
-- or message text.

-- When a shop finished onboarding. Until now only a boolean existed, so the
-- moment itself was lost. Five different code paths flip the boolean; a
-- trigger stamps the time for all of them. Rows that were already complete
-- before this migration stay NULL — the sync approximates those from
-- onboarding_events / trial_started_at and marks them approximate.
alter table public.businesses
  add column if not exists onboarding_completed_at timestamptz;

create or replace function public.stamp_onboarding_completed_at()
returns trigger language plpgsql as $$
begin
  if new.onboarding_completed is true and new.onboarding_completed_at is null then
    if tg_op = 'INSERT' or old.onboarding_completed is distinct from true then
      new.onboarding_completed_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists businesses_stamp_onboarding_completed_at on public.businesses;
create trigger businesses_stamp_onboarding_completed_at
  before insert or update on public.businesses
  for each row execute function public.stamp_onboarding_completed_at();

create table if not exists public.funnel_events (
  id           bigint generated always as identity primary key,
  business_id  uuid        not null references public.businesses(id) on delete cascade,
  event        text        not null check (event in (
    'registered', 'onboarding_completed', 'first_customer_message', 'activated',
    'trial_started', 'payment_submitted', 'payment_confirmed',
    'subscription_renewed', 'churned'
  )),
  occurred_at  timestamptz not null,
  -- '' for once-per-shop events; the source row for repeatable ones
  -- (e.g. 'se:<subscription_events.id>'), so re-running never double counts.
  dedupe_key   text        not null default '',
  metadata     jsonb       not null default '{}'::jsonb,
  source       text        not null default 'sync' check (source in ('live', 'sync', 'backfill')),
  created_at   timestamptz not null default now(),
  unique (business_id, event, dedupe_key)
);

create index if not exists funnel_events_event_time_idx
  on public.funnel_events (event, occurred_at);

-- Service role only (it bypasses RLS); no anon/authenticated access.
alter table public.funnel_events enable row level security;
