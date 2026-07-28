-- 029_delegation.sql — Team delegation loop ("chief of staff").
--
-- Turns agent_tasks into work the agent can HAND TO A PERSON and then chase
-- until it's done: assign → accept → remind before due → chase when overdue →
-- escalate to the owner when the assignee goes silent → complete (+ photo) →
-- notify the customer.
--
-- Additive only. New task type 'delegated_task' reuses existing columns where
-- they already fit (supplier_id = the assignee, customer_id = who it's for,
-- scheduled_at = when the cron next acts) and adds a small set of new ones for
-- the commitment time and the chase bookkeeping.
--
-- Follows the pattern of 023_owner_tasks.sql (drop + re-add the CHECK
-- constraints, preserving every existing value). Apply in the Supabase SQL
-- editor — DDL cannot run through the service-role key without a PAT.

-- ── 1. Extend the type CHECK ────────────────────────────────────────────────
-- Preserve all 12 values from migration 023, add 'delegated_task'.
alter table agent_tasks
  drop constraint if exists agent_tasks_type_check;
alter table agent_tasks
  add constraint agent_tasks_type_check check (type in (
    'supply_reorder', 'delivery_schedule', 'payment_followup',
    'inventory_check', 'customer_followup', 'price_update',
    'reminder', 'scheduled_message', 'followup', 'broadcast', 'briefing',
    'owner_action',
    'delegated_task'
  ));

-- ── 2. Extend the status CHECK ──────────────────────────────────────────────
-- The base CHECK (schema.sql:184) has no 'blocked' — a delegated task that a
-- team member reports stuck on parts/info needs it. Preserve every existing
-- value, add 'blocked'.
alter table agent_tasks
  drop constraint if exists agent_tasks_status_check;
alter table agent_tasks
  add constraint agent_tasks_status_check check (status in (
    'pending', 'awaiting_approval', 'approved', 'in_progress',
    'completed', 'failed', 'cancelled',
    'blocked'
  ));

-- ── 3. Delegation columns on agent_tasks ────────────────────────────────────
-- scheduled_at keeps its meaning (when the cron next acts). due_at is the
-- separate human commitment — moving the chase schedule must never move the
-- deadline. assignee_message_id is distinct from notification_message_id
-- (which already tracks the owner-facing approval preview for owner_action).
alter table agent_tasks
  add column if not exists due_at              timestamptz,
  add column if not exists assigned_at         timestamptz,
  add column if not exists accepted_at         timestamptz,
  add column if not exists blocked_reason      text,
  add column if not exists chase_count         int default 0,
  add column if not exists last_chased_at      timestamptz,
  add column if not exists escalated_at        timestamptz,
  add column if not exists completion_note     text,
  add column if not exists completion_file_id  text,   -- telegram file_id, not a URL
  add column if not exists created_by          text,   -- owner|agent|customer_request|team_member
  add column if not exists assignee_message_id bigint; -- brief DM to the assignee

-- ── 4. Workload / availability on suppliers (the team roster) ────────────────
alter table suppliers
  add column if not exists max_daily_tasks int default 5,
  add column if not exists active_hours    text;         -- "09:00-18:00" EAT wall-clock

-- ── 5. Audit trail for the delegation loop ──────────────────────────────────
create table if not exists agent_task_events (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references agent_tasks(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  actor      text,   -- 'agent' | 'owner' | 'assignee' | supplier name
  action     text,   -- 'created'|'assigned'|'accepted'|'declined'|'progress'|
                      -- 'blocked'|'chased'|'escalated'|'completed'|'reassigned'|'cancelled'
  note       text,
  created_at timestamptz default now()
);

create index if not exists idx_agent_task_events_task
  on agent_task_events(task_id, created_at desc);

-- ── 6. Indexes ──────────────────────────────────────────────────────────────
-- The hourly delegation cron scans due delegated tasks that are still live.
create index if not exists idx_agent_tasks_delegated_due
  on agent_tasks(scheduled_at)
  where type = 'delegated_task'
    and status in ('pending', 'in_progress', 'blocked');

-- The inbound reply hook looks a supplier up by Telegram id on EVERY customer
-- message. No index existed for this before (handleSupplierReply already does
-- the same unindexed lookup — this speeds up both paths).
create index if not exists idx_suppliers_contact_telegram
  on suppliers(contact_telegram)
  where is_active = true;

-- Counting a team member's open workload for assignment balancing.
create index if not exists idx_agent_tasks_assignee_open
  on agent_tasks(supplier_id)
  where type = 'delegated_task'
    and status in ('pending', 'in_progress', 'blocked');
