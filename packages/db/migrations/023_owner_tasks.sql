-- 023_owner_tasks.sql
-- Owner-assigned, scheduled agent tasks ("give it a task, it executes").
--
-- The owner DMs the bot in natural language ("message Sara on Friday",
-- "every Monday DM my VIPs"). handleOwnerPrompt creates an agent_tasks row
-- of type 'owner_action'; a cron (/api/cron/agent-tasks) drafts the message at
-- the scheduled time, sets status='awaiting_approval', and DMs the owner an
-- approve/cancel preview (reusing the existing approval-callback pattern).
--
-- This is ADDITIVE: it only extends the type CHECK constraint. No columns are
-- added — owner_action reuses existing columns:
--   scheduled_at  -> next run time (UTC)
--   payload       -> { action, target, message_draft, recurrence, last_sent_at }
--                    action ∈ 'dm_client' | 'dm_team' | 'broadcast'
--                    recurrence = { kind: 'once'|'daily'|'weekly', day_of_week?, time_eat }
--   status        -> pending -> awaiting_approval -> completed/cancelled
--                    (recurring rows return to 'pending' after each approved send)
--   requires_approval, notification_message_id, title, description
--
-- Preserves all 11 types from migration 003; adds 'owner_action'.

alter table agent_tasks
  drop constraint if exists agent_tasks_type_check;
alter table agent_tasks
  add constraint agent_tasks_type_check check (type in (
    'supply_reorder', 'delivery_schedule', 'payment_followup',
    'inventory_check', 'customer_followup', 'price_update',
    'reminder', 'scheduled_message', 'followup', 'broadcast', 'briefing',
    'owner_action'
  ));

-- The scheduling index from migration 003 already covers (business_id, status,
-- scheduled_at); the cron scans by (type, status, scheduled_at). Add a partial
-- index so the due-task scan stays cheap as owner_action volume grows.
create index if not exists idx_agent_tasks_owner_action_due
  on agent_tasks(scheduled_at)
  where type = 'owner_action' and status = 'pending';
