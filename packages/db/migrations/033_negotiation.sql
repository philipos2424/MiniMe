-- 033_negotiation.sql — Supplier Negotiation Engine.
--
-- Gives agent_tasks a real "in a live negotiation" state instead of dead-ending
-- right after outreach, plus a scheduled-timeout type so a stalled negotiation
-- escalates to the owner instead of silently rotting.
--
-- Also legitimizes 'executing', which apps/bot/src/services/scheduler.js already
-- writes to agent_tasks.status on every fired task (scheduler.js:106) — that
-- write has been silently violating the live CHECK constraint since scheduler
-- shipped. Additive only. Apply in the Supabase SQL editor — DDL can't run
-- through the service-role key without a PAT.

-- ── 1. agent_tasks.status: add 'negotiating', 'executing' ──────────────────
alter table agent_tasks drop constraint if exists agent_tasks_status_check;
alter table agent_tasks add constraint agent_tasks_status_check check (status in (
  'pending', 'awaiting_approval', 'approved', 'in_progress',
  'completed', 'failed', 'cancelled', 'blocked',
  'negotiating', 'executing'
));

-- ── 2. agent_tasks.type: add 'negotiation_timeout' ──────────────────────────
alter table agent_tasks drop constraint if exists agent_tasks_type_check;
alter table agent_tasks add constraint agent_tasks_type_check check (type in (
  'supply_reorder', 'delivery_schedule', 'payment_followup',
  'inventory_check', 'customer_followup', 'price_update',
  'reminder', 'scheduled_message', 'followup', 'broadcast', 'briefing',
  'owner_action', 'delegated_task',
  'negotiation_timeout'
));

-- ── 3. businesses.negotiation_mode ──────────────────────────────────────────
alter table businesses
  add column if not exists negotiation_mode text default 'draft';

alter table businesses drop constraint if exists businesses_negotiation_mode_check;
alter table businesses add constraint businesses_negotiation_mode_check
  check (negotiation_mode in ('draft', 'auto', 'full'));

-- ── 4. Fast lookup for the scheduler / dashboards ───────────────────────────
create index if not exists idx_agent_tasks_negotiating
  on agent_tasks(business_id) where status = 'negotiating';
