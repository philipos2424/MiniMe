-- 026_onboarding_events.sql
-- Funnel telemetry for the onboarding wizard.
--
-- The wizard (apps/web .../onboarding/page.js) is pure client state and writes
-- nothing until the very end of the flow, so this table is the ONLY window we
-- have into WHERE owners abandon. POST /api/onboarding/track writes one row per
-- wizard step; GET /api/admin/funnel and /api/admin/advisor read it back to
-- build the signup→activation funnel and per-owner journeys.
--
-- This table had no migration — every consumer referenced it but nothing ever
-- created it. The track route swallows insert errors ("telemetry is best-effort
-- and must never surface"), so writes failed silently against the missing table
-- and the admin funnel showed "no telemetry" for every owner. This creates it.
--
-- Safe to run multiple times.

create table if not exists onboarding_events (
  id          bigint generated always as identity primary key,
  telegram_id bigint,                                  -- owner Telegram user id (funnel denominator); nullable, best-effort
  step        text not null,                           -- whitelisted wizard step, see track/route.js VALID_STEPS
  meta        jsonb,                                   -- tiny optional blob, capped at 500 chars by the writer
  created_at  timestamptz not null default now()
);

-- The funnel/advisor reads filter on created_at >= now()-30d and order by it.
create index if not exists onboarding_events_created_at_idx
  on onboarding_events (created_at);

-- Per-owner rollups join events back to businesses by telegram_id.
create index if not exists onboarding_events_telegram_id_idx
  on onboarding_events (telegram_id);

-- Only ever written/read with the service-role key (lib/server/db.js), which
-- bypasses RLS. Enable RLS with no policy so anon/authenticated clients get
-- nothing — this table holds telegram_ids (personal data) and must never be
-- exposed through the public PostgREST surface.
alter table onboarding_events enable row level security;
