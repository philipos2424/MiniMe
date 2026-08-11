-- 033_agent_task_scheduling_fix.sql
--
-- Repairs a schema/code split that silently disabled the entire scheduling
-- subsystem.
--
-- The code has been writing agent_tasks rows with status = 'scheduled' since
-- migration 003 added scheduled_at (scheduler.js createReminder /
-- createScheduledMessage, agent.js checkCustomerFollowups, and the briefing
-- job all do it). But no migration ever added 'scheduled' to the status CHECK
-- constraint, so every one of those inserts was rejected by Postgres. The
-- callers log the error and return null, so it failed silently:
--
--   * reminders and scheduled messages were never stored
--   * fireDueTasks() (cron, every minute) queries status='scheduled' and has
--     therefore always matched zero rows
--   * cold-lead and silent-quote follow-ups were never created
--
-- Same story for `context`, which scheduler.js reads (task.context.text,
-- task.context.message) and agent.js writes — the column does not exist.
--
-- Verified against the live database before writing this migration:
--   status=scheduled -> violates check constraint "agent_tasks_status_check"
--   context          -> column not found
--   payment_id       -> column not found
--
-- Idempotent and safe to re-run.

-- ── 1. Allow the 'scheduled' status ─────────────────────────────────────────
-- Preserves every value from schema.sql:184 and migration 029 ('blocked').
alter table agent_tasks
  drop constraint if exists agent_tasks_status_check;
alter table agent_tasks
  add constraint agent_tasks_status_check check (status in (
    'pending', 'awaiting_approval', 'approved', 'in_progress',
    'completed', 'failed', 'cancelled',
    'blocked',
    'scheduled'
  ));

-- ── 2. context: per-task payload for scheduled work ─────────────────────────
-- Distinct from `payload` (which supply_reorder uses for the product/supplier
-- snapshot). scheduler.js expects context.text for reminders and
-- context.message for scheduled messages.
alter table agent_tasks
  add column if not exists context jsonb default '{}'::jsonb;

-- ── 3. payment_id: lets the cron dedupe payment follow-ups ──────────────────
-- checkPaymentFollowups had no dedupe key at all, so it created a new task and
-- a new owner notification for the same unpaid invoice on every 30-minute tick.
alter table agent_tasks
  add column if not exists payment_id uuid references payments(id) on delete set null;

-- ── 4. Indexes supporting the dedupe + due-task queries ─────────────────────
create index if not exists idx_agent_tasks_open_dedupe
  on agent_tasks(business_id, type, status);

create index if not exists idx_agent_tasks_payment
  on agent_tasks(payment_id)
  where payment_id is not null;
