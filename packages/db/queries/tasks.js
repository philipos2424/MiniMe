const { supabase } = require('../client');
const { OPEN_TASK_STATUSES } = require('../../shared/constants');

async function create(taskData) {
  const { data, error } = await supabase.from('agent_tasks').insert(taskData).select().single();
  if (error) { console.error('tasks.create error:', error); return null; }
  return data;
}

async function findById(id) {
  const { data } = await supabase.from('agent_tasks').select('*').eq('id', id).single();
  return data;
}

async function findByBusiness(businessId, { status, statuses, limit = 50, columns = '*' } = {}) {
  let q = supabase.from('agent_tasks').select(columns).eq('business_id', businessId).order('created_at', { ascending: false }).limit(limit);
  if (statuses && statuses.length) q = q.in('status', statuses);
  else if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

/**
 * All tasks for a business that still represent open work, in one query.
 * Used by the cron agent to avoid creating a duplicate task on every tick.
 *
 * THROWS on a query error rather than returning []. Supabase reports errors
 * in-band, so a swallowed error here would be indistinguishable from "this
 * business has no open tasks" — and an empty dedupe set means the cron
 * recreates every task it has ever created, which is the exact bug the
 * dedupe exists to prevent. Callers must treat a throw as "skip this tick".
 *
 * Selects only the dedupe keys (not `*`) so the row cap can be high enough
 * that the window never truncates. findByBusiness orders created_at DESC, so
 * a truncated window would silently drop the OLDEST open tasks — precisely
 * the long-standing un-actioned ones most likely to be recreated.
 */
async function findOpen(businessId, limit = 2000) {
  let q = supabase
    .from('agent_tasks')
    .select('id, type, status, product_id, payment_id, customer_id')
    .eq('business_id', businessId)
    .in('status', OPEN_TASK_STATUSES)
    .limit(limit);

  const { data, error } = await q;
  if (error) throw new Error(`tasks.findOpen(${businessId}): ${error.message}`);
  return data || [];
}

async function updateTask(id, updates) {
  const { data, error } = await supabase.from('agent_tasks').update(updates).eq('id', id).select().single();
  if (error) { console.error('tasks.update error:', error); return null; }
  return data;
}

/**
 * Mark a task failed and record why.
 *
 * `agent_tasks` has no `error` column. Callers used to pass one anyway, and
 * because PostgREST rejects the WHOLE request on an unknown column, the
 * `status: 'failed'` in the same payload never landed either — so every task
 * that errored stayed stuck in its previous state forever. The reason now goes
 * into `decision_log`, which does exist.
 */
async function failTask(id, reason) {
  await addDecisionLog(id, { action: 'failed', reason: String(reason || 'unknown') });
  return updateTask(id, { status: 'failed', completed_at: new Date().toISOString() });
}

async function addStep(id, step) {
  const task = await findById(id);
  if (!task) return null;
  const steps = [...(task.steps || []), { ...step, timestamp: new Date().toISOString() }];
  return updateTask(id, { steps });
}

async function addDecisionLog(id, entry) {
  const task = await findById(id);
  if (!task) return null;
  const log = [...(task.decision_log || []), { ...entry, timestamp: new Date().toISOString() }];
  return updateTask(id, { decision_log: log });
}

async function getPendingApproval(businessId) {
  return findByBusiness(businessId, { status: 'awaiting_approval' });
}

module.exports = { create, findById, findByBusiness, findOpen, updateTask, failTask, addStep, addDecisionLog, getPendingApproval };
