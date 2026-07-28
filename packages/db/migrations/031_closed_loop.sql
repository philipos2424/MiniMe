-- 031_closed_loop.sql — Client → member → client, as a real conversation.
--
-- Increment 3 on the delegation loop. Two things this adds:
--
--   1. The client round-trip: link a task to the conversation that created it
--      (so brief-backs don't re-guess "newest conversation"), and a guard so a
--      completion brief is never sent twice.
--
--   2. A real conversation with the team member: no more one-off DMs with no
--      memory. team_threads gives MiniMe a history to reason over, and
--      biz_conn_chats lets it know — for real, not by guessing — which chats
--      the owner's personal Telegram account can actually reach, so it can
--      speak as the owner when possible and fall back to the bot without a
--      silent failure when not.
--
-- Additive only. Apply in the Supabase SQL editor — DDL can't run through the
-- service-role key without a PAT.

-- ── 1. Client round-trip bookkeeping ────────────────────────────────────────
alter table agent_tasks
  add column if not exists source_conversation_id uuid references conversations(id) on delete set null,
  add column if not exists client_briefed_at timestamptz;

-- ── 2. Per-member channel preference + one-time AI disclosure tracking ─────
alter table suppliers
  add column if not exists contact_channel text default 'auto',  -- auto|bot|personal
  add column if not exists ai_disclosed_at timestamptz;

-- ── 3. Team conversation history ────────────────────────────────────────────
-- Deliberately NOT a `conversations` row: that table's customer_id is NOT NULL
-- and dozens of queries assume a customer, so widening it is high-risk for no
-- gain. This mirrors the existing job_threads idiom — a capped JSONB message
-- array keyed by (business, supplier) — but supports the delegation loop's
-- 1:1 team-member conversations rather than job-scoped threads.
create table if not exists team_threads (
  business_id uuid not null references businesses(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  task_id     uuid references agent_tasks(id) on delete set null,
  messages    jsonb default '[]'::jsonb,
  last_message_at timestamptz,
  created_at  timestamptz default now(),
  primary key (business_id, supplier_id)
);

-- ── 4. Persisted Business-API coverage ──────────────────────────────────────
-- Which chats we have PROVEN the owner's personal Telegram account can reach.
-- Telegram only lets a Business-connected bot send into chats the connection
-- already covers, and offers no API to enumerate them — so this is built up
-- from real inbound business_message traffic (the only reliable signal) and
-- consulted before ever attempting a personal-identity send.
create table if not exists biz_conn_chats (
  business_id uuid not null references businesses(id) on delete cascade,
  chat_id     bigint not null,
  conn_id     text,
  last_seen_at timestamptz default now(),
  send_ok_at   timestamptz,
  send_failed_at timestamptz,
  primary key (business_id, chat_id)
);

create index if not exists idx_team_threads_business on team_threads(business_id);
create index if not exists idx_biz_conn_chats_business on biz_conn_chats(business_id);
