const { supabase } = require('../client');

async function create(taskData) {
  const { data, error } = await supabase.from('agent_tasks').insert(taskData).select().single();
  if (error) { console.error('tasks.create error:', error); return null; }
  return data;
}

async function findById(id) {
  const { data } = await supabase.from('agent_tasks').select('*').eq('id', id).single();
  return data;
}

async function findByBusiness(businessId, { status, statuses, limit = 50 } = {}) {
  let q = supabase.from('agent_tasks').select('*').eq('business_id', businessId).order('created_at', { ascending: false }).limit(limit);
  if (statuses && statuses.length) q = q.in('status', statuses);
  else if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

/**
 * All tasks for a business that still represent open work, in one query.
 * Used by the cron agent to avoid creating a duplicate task on every tick.
 */
async function findOpen(businessId, limit = 200) {
  const { OPEN_TASK_STATUSES } = require('../../shared/constants');
  return findByBusiness(businessId, { statuses: OPEN_TASK_STATUSES, limit });
}

async function updateTask(id, updates) {
  const { data, error } = await supabase.from('agent_tasks').update(updates).eq('id', id).select().single();
  if (error) { console.error('tasks.update error:', error); return null; }
  return data;
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

module.exports = { create, findById, findByBusiness, findOpen, updateTask, addStep, addDecisionLog, getPendingApproval };
