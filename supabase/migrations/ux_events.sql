-- MiniMe UX events — behavioural telemetry for the Agent Mini App + public surfaces.
-- Run in Supabase SQL Editor.
--
-- One row per user interaction (click / view / nav / submit / dwell). This is the
-- ONLY place we can see what owners actually DO inside the Mini App: the dashboard
-- is ~50 client-rendered screens that write nothing until a domain action succeeds,
-- so every abandoned, confusing or simply unused screen is currently invisible.
--
-- Deliberately NO CHECK enum on `event` / `intent`. The older streams
-- (market_events, onboarding_events) constrain their vocabulary in two places
-- each — a route-level Set AND a SQL CHECK — which means adding a single new
-- event costs a code change plus a migration. That friction is why the dashboard
-- never got instrumented at all. Here the vocabulary is open and the SAFETY is
-- enforced by shape instead: hard length caps + a meta key whitelist + a PII
-- scrub in /api/track, so an open vocabulary can't become an open PII channel.

CREATE TABLE IF NOT EXISTS ux_events (
  id           BIGSERIAL PRIMARY KEY,
  -- Client-generated, rolls over after 30 min idle. Groups a burst of activity
  -- into one "visit" so paths and funnels can be reconstructed.
  session_id   UUID NOT NULL,
  -- Monotonic within a session. Ordering must not depend on the client clock:
  -- Mini Apps run on cheap Android handsets whose wall clock is often minutes
  -- off, which would silently scramble any ORDER BY occurred_at.
  seq          INTEGER NOT NULL,
  surface      TEXT NOT NULL,   -- 'dashboard' | 'market' | 'directory' | 'shop'
  event        TEXT NOT NULL,   -- 'click' | 'view' | 'nav' | 'submit' | 'dwell'
  intent       TEXT,            -- from data-intent, e.g. 'agent.teach.save'; null = unannotated
  route        TEXT,            -- normalized pathname, e.g. /conversations/[id]
  target       TEXT,            -- structural descriptor (tag#id.class); NEVER element text
  business_id  UUID,
  tg_user_id   TEXT,            -- pseudonymous; TEXT to match market_events (onboarding_events uses BIGINT)
  meta         JSONB,           -- small, key-whitelisted scalars only
  occurred_at  TIMESTAMPTZ NOT NULL,  -- client clock; useful for in-session deltas, not for ordering
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ux_events_created  ON ux_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ux_events_session  ON ux_events (session_id, seq);
CREATE INDEX IF NOT EXISTS idx_ux_events_biz      ON ux_events (business_id, created_at DESC) WHERE business_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ux_events_intent   ON ux_events (intent, created_at DESC) WHERE intent IS NOT NULL;
-- Feature ranking joins ux_feature_map on route and filters by day.
CREATE INDEX IF NOT EXISTS idx_ux_events_route    ON ux_events (route, created_at DESC) WHERE route IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ux_events_user     ON ux_events (tg_user_id, created_at DESC) WHERE tg_user_id IS NOT NULL;

-- No policies: writes go through the service-role client in /api/track and reads
-- through admin-guarded server routes. RLS on with zero policies means the anon
-- key (which the dashboard runs on) cannot read other tenants' behaviour.
ALTER TABLE ux_events ENABLE ROW LEVEL SECURITY;
