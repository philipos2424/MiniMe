-- 021_signup_sessions.sql
-- Durable state for the in-Telegram conversational signup on @MiniMeAgentBot.
--
-- The signup flow spans several webhook invocations (name → category → mode →
-- token). On serverless those invocations can land on different instances, so
-- the previous in-memory Map dropped owners mid-signup. This table persists the
-- per-user signup session so it survives across invocations.
--
-- Safe to run multiple times.

create table if not exists signup_sessions (
  user_id    text primary key,                       -- owner Telegram user id (as text)
  step       text not null,                          -- 'name' | 'category' | 'mode' | 'awaiting_token'
  data       jsonb not null default '{}'::jsonb,      -- { name?, category?, businessId? }
  updated_at timestamptz not null default now()
);

-- Lets a periodic cleanup (or the app's TTL sweep) find stale half-signups fast.
create index if not exists signup_sessions_updated_at_idx
  on signup_sessions (updated_at);
