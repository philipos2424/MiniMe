-- 024_reminder_recovery_and_memory.sql
-- Recovery for "fire and forget" reminders/scheduled messages:
--
--   agent_tasks (owner_action, awaiting_approval) — the owner is DMed a draft
--   and must tap Send. If they never act, the task just sits there forever.
--   Add nudge tracking so /api/cron/agent-task-nudges can re-ping the owner a
--   bounded number of times.
--
--   scheduled_messages — currently a permanent 'failed' status with no retry.
--   Add retry bookkeeping so /api/cron/scheduled-messages can back off and
--   retry, then notify the owner once retries are exhausted.

alter table agent_tasks
  add column if not exists nudge_count int default 0,
  add column if not exists last_nudged_at timestamptz;

create index if not exists idx_agent_tasks_awaiting_approval
  on agent_tasks(scheduled_at)
  where status = 'awaiting_approval';

alter table scheduled_messages
  add column if not exists retry_count int default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists owner_notified_failed boolean default false;

create index if not exists idx_scheduled_messages_retry
  on scheduled_messages(next_retry_at)
  where status = 'pending' and retry_count > 0;
