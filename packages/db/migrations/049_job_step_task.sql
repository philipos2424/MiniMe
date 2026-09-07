-- 049_job_step_task.sql — Join the planner to the chase loop.
--
-- Two systems have been doing half a manager's job each:
--
--   jobs + job_steps (008)   knows how to think in PLANS — ordered steps, a role
--                            per step, a client-visible timeline — but picks
--                            people by role alone, never asks whether they
--                            accepted, never chases, never escalates. Nothing
--                            in the codebase ever marks a supplier step 'done';
--                            steps reach 'waiting' and stay there forever.
--
--   agent_tasks (029/030)    knows how to MANAGE A PERSON — accept, remind,
--   type='delegated_task'    chase, escalate, capacity caps, working hours, a
--                            real conversation, team-group visibility, and the
--                            audit trail memberProfile now reads back — but it
--                            is flat: one task, one person, no sequence.
--
-- task_id is the join. A plan step now IS a delegated task: activateStep
-- creates one and proposeAssignment routes it, so multi-step work inherits the
-- entire loop instead of a one-shot DM. Completing that task marks the step
-- done and advances the job — the completion path job_steps never had.
--
-- Deliberately ONE column, not a new table. If joining these needed more than a
-- back-reference, the design would be wrong.
--
-- ON DELETE SET NULL: deleting a task must never cascade away the plan step
-- that records what was supposed to happen.
--
-- The code degrades without this migration: the step still activates and the
-- task is still assigned and chased, it just can't auto-advance the job. Apply
-- in the Supabase SQL editor — DDL can't run through the service-role key
-- without a PAT.

alter table job_steps
  add column if not exists task_id uuid references agent_tasks(id) on delete set null;

-- Completion looks a step up BY task id, which is the only new access path.
create index if not exists job_steps_task_idx on job_steps(task_id);
