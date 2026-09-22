/**
 * Job fan-out engine — the PLAN half of delegation.
 *
 * A job is a client request broken into ordered steps. This module decides
 * which step is next and hands it to a person; everything that happens after
 * that hand-off belongs to delegation.js.
 *
 * That split is new. This file used to pick a supplier by role, write a brief,
 * DM it and mark the step 'waiting' — a second, weaker copy of a loop that
 * already existed, with no acceptance, no chasing, no escalation, no capacity
 * or working-hours awareness, and (because nothing here ever marked a supplier
 * step done) no way to finish. Steps reached 'waiting' and stopped.
 *
 * Now a step IS a delegated task (job_steps.task_id, migration 049):
 *   1. activateStep creates the task and lets proposeAssignment route it,
 *   2. the delegation loop owns acceptance, chasing, escalation and completion,
 *   3. completeTask calls advanceJob, which marks the step done and briefs the
 *      next one — the completion path this system never had.
 *
 * Client attachments are no longer forwarded by hand here: the task carries
 * source_conversation_id, and forwardTaskFiles sends that conversation's files
 * scoped to the right client.
 */
import { makeOpenAI } from './openaiClient';
import { MODEL } from './constants';
import { supabase } from './db';
import { logEvent } from './jobs';
import { nextPlanAction } from './delegationLogic.mjs';

const openai = makeOpenAI();

const FALLBACK_BRIEF = ({ job, step }) =>
  `${step.label}\n\nJob: ${job.title}\n${job.description || ''}\n` +
  (job.deadline ? `Deadline: ${new Date(job.deadline).toLocaleDateString()}\n` : '') +
  (job.budget ? `Budget: ${Number(job.budget).toLocaleString()} ${job.currency || 'ETB'}\n` : '') +
  `\nPlease confirm if you can handle this.`;

// ────────────────────────────── Brief generation ──────────────────────────────
export async function generateBrief({ job, step, businessName }) {
  const sys =
    'You write clean supplier briefs. 4-7 short lines. Include: WHAT, QUANTITIES, DEADLINE, BUDGET if given, DELIVERABLES, CONTACT. No fluff, no greetings.';
  const user =
    `Business: ${businessName || 'Our business'}
Job title: ${job.title}
Description: ${job.description || '(none)'}
Deadline: ${job.deadline ? new Date(job.deadline).toISOString() : 'not set'}
Budget: ${job.budget ? `${job.budget} ${job.currency || 'ETB'}` : 'not set'}

Step to brief: ${step.label}
Supplier role: ${step.role || 'supplier'}

Write the brief as plain text (no markdown headers, no greeting).`;
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 300,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
    });
    const text = res.choices[0]?.message?.content?.trim();
    return text || FALLBACK_BRIEF({ job, step });
  } catch (e) {
    console.warn('generateBrief:', e.message);
    return FALLBACK_BRIEF({ job, step });
  }
}

// ────────────────────────────── Supplier selection ──────────────────────────────
export async function pickSupplier({ businessId, role }) {
  const sb = supabase();
  const { data, error } = await sb
    .from('suppliers')
    .select('*')
    .eq('business_id', businessId)
    .eq('role', role)
    .eq('is_active', true)
    .order('total_orders', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) { console.warn('pickSupplier:', error.message); return null; }
  return (data && data[0]) || null;
}

// ────────────────────────────── Step activation ──────────────────────────────
async function loadStep({ jobId, stepIndex, stepId }) {
  const sb = supabase();
  let q = sb.from('job_steps').select('*');
  if (stepId) q = q.eq('id', stepId);
  else q = q.eq('job_id', jobId).eq('order_index', stepIndex);
  const { data } = await q.maybeSingle();
  return data;
}

async function markStep(stepId, updates) {
  await supabase().from('job_steps').update(updates).eq('id', stepId);
}

/**
 * Activate a single job step. If it's a passive step (client/agent), mark it
 * done/active and return so the caller can advance. Otherwise: pick a supplier,
 * generate a brief, DM them, record everything.
 */
export async function activateStep({ token, jobId, stepIndex, stepId }) {
  const sb = supabase();
  const step = await loadStep({ jobId, stepIndex, stepId });
  if (!step) return { advanced: false, reason: 'step not found' };

  // Passive steps: no supplier fan-out needed.
  if (!step.auto || step.role === 'client' || step.role === 'agent') {
    await markStep(step.id, { status: 'active', started_at: new Date().toISOString() });
    return { advanced: true, reason: 'passive step activated' };
  }

  // Load the job + business for context.
  const { data: job } = await sb.from('jobs').select('*, businesses(id, name)').eq('id', step.job_id).maybeSingle();
  if (!job) return { advanced: false, reason: 'job not found' };
  const businessName = job.businesses?.name || 'Our business';

  // ── The step becomes a delegated task ────────────────────────────────────
  // This used to pick a supplier by role, generate a brief, DM it, and mark the
  // step 'waiting' — where it stayed forever, because nothing in this file ever
  // marked a supplier step done. No acceptance, no chase, no escalation, no
  // capacity or working-hours awareness: a parallel, weaker copy of the loop
  // agent_tasks already runs.
  //
  // So the step now IS a delegated task. createDelegatedTask + proposeAssignment
  // bring assignee ranking (role, specialty, load, cap), acceptance tracking,
  // the reliability-paced chase ladder, escalation to the owner, the team-group
  // post, file forwarding and a real conversation with the member — none of
  // which this function has to know anything about.
  //
  // Imported lazily: delegation.js imports pickSupplier from this module, so a
  // static import would close a cycle.
  const { data: business } = await sb.from('businesses').select('*').eq('id', job.business_id).maybeSingle();
  if (!business) return { advanced: false, reason: 'business not found' };

  // The LLM brief is kept — it becomes the task's description, which is what
  // teamBrain writes the member's opening message from. Better substance in,
  // better brief out.
  const brief = await generateBrief({ job, step, businessName });

  const { createDelegatedTask, proposeAssignment } = await import('./delegation');
  const created = await createDelegatedTask(sb, business, {
    title: step.label,
    description: brief,
    role: step.role,
    due_at: job.deadline || null,
    customer_id: job.customer_id || null,
    // Scopes forwardTaskFiles to the conversation that actually spawned this
    // job, so the assignee gets that client's reference files and nobody
    // else's — the reason this no longer forwards attachments by hand.
    source_conversation_id: job.conversation_id || null,
    created_by: 'agent',
  });

  if (!created.ok) {
    await markStep(step.id, {
      status: 'blocked',
      started_at: new Date().toISOString(),
      outbound_summary: `Could not create the task: ${created.error}`,
    });
    return { advanced: false, reason: `task not created: ${created.error}` };
  }

  await markStep(step.id, {
    status: 'waiting',
    started_at: new Date().toISOString(),
    brief,
    outbound_summary: brief.slice(0, 200),
  });

  // Migration-gated (049): written separately so a database without task_id
  // still activates the step and still chases the assignee — it just can't
  // auto-advance the job when the task completes.
  const { error: linkError } = await sb.from('job_steps')
    .update({ task_id: created.task.id }).eq('id', step.id);
  if (linkError) {
    console.warn('[jobFanout] job_steps.task_id not written — migration 049 not applied?', linkError.message);
  }

  // Routing decides who, and whether the owner is asked first: trust-gated
  // inside proposeAssignment exactly as an owner-initiated delegation is.
  await proposeAssignment({ sb, token, business, task: created.task });

  await logEvent(step.job_id, {
    kind: 'auto_sent',
    icon: step.icon || '📨',
    title: `Delegated: ${step.label}`,
    body: brief.slice(0, 300),
    auto: true,
    color: 'purple',
  });

  return { advanced: true, reason: 'step delegated' };
}


// ────────────────────────────── Advancing a plan ──────────────────────────────
/**
 * A delegated task finished, so the step it backed is done — move the plan on.
 *
 * This is the completion path job_steps never had. Before migration 049 there
 * was no way back from a task to its step, so a supplier step reached 'waiting'
 * and stopped there: the plan had no idea the work had landed.
 *
 * Deliberately narrow. It marks THIS step done and activates the next one that
 * isn't already in flight — a step sitting in 'waiting' has a live task and a
 * chase schedule of its own, and re-activating it would brief the same person
 * twice for the same work.
 *
 * Called from completeTask, which already owns telling the owner, the customer
 * and the team group. Failing here must never fail the completion, so the
 * caller swallows errors.
 */
export async function advanceJob({ token, taskId }) {
  const sb = supabase();

  const { data: step, error } = await sb.from('job_steps')
    .select('id, job_id, order_index, label')
    .eq('task_id', taskId)
    .maybeSingle();
  // No row, or no task_id column yet (migration 049): this task simply isn't
  // part of a plan, which is the ordinary case for owner-delegated work.
  if (error || !step) return { advanced: false, reason: 'not a plan step' };

  await markStep(step.id, { status: 'done', completed_at: new Date().toISOString() });
  await logEvent(step.job_id, {
    kind: 'received',
    icon: '✅',
    title: `Done: ${step.label}`,
    auto: true,
    color: 'green',
  });

  const { data: steps } = await sb.from('job_steps')
    .select('*').eq('job_id', step.job_id).order('order_index');
  let remaining = steps || [];

  // nextPlanAction returns ONE step at a time, so a run of passive agent steps
  // is consumed by looping rather than by duplicating the rules here. Bounded
  // by the step count: every pass marks one step done.
  for (let guard = remaining.length; guard >= 0; guard--) {
    const { action, step: next } = nextPlanAction(remaining);

    if (action === 'in_flight') return { advanced: false, reason: 'another step in flight' };

    if (action === 'job_complete') {
      await sb.from('jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', step.job_id);
      await logEvent(step.job_id, {
        kind: 'completed', icon: '🎉', title: 'Job complete', auto: true, color: 'green',
      });
      return { advanced: true, reason: 'job complete' };
    }

    await sb.from('jobs').update({ current_step: next.order_index }).eq('id', step.job_id);

    if (action === 'await_client') {
      await markStep(next.id, { status: 'active', started_at: new Date().toISOString() });
      return { advanced: true, reason: 'awaiting client' };
    }

    if (action === 'auto_complete') {
      await markStep(next.id, {
        status: 'done',
        started_at: next.started_at || new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      remaining = remaining.map(s => (s.id === next.id ? { ...s, status: 'done' } : s));
      continue;
    }

    return activateStep({ token, jobId: step.job_id, stepId: next.id });
  }

  return { advanced: false, reason: 'step list did not settle' };
}

// ────────────────────────────── Job kickoff ──────────────────────────────
/**
 * Called when the owner approves the job. Walks the step list from the
 * current_step onward, skipping passive agent/client steps (marking them done
 * if they haven't been done yet), and activates the first real supplier step.
 */
export async function kickoffJob({ token, jobId }) {
  const sb = supabase();
  const { data: steps } = await sb
    .from('job_steps')
    .select('*')
    .eq('job_id', jobId)
    .order('order_index');
  if (!steps || !steps.length) return { advanced: false, reason: 'no steps' };

  for (const step of steps) {
    if (step.status === 'done' || step.status === 'skipped') continue;

    // Agent/client passive steps before the first real supplier step:
    // auto-complete "agent" steps (analysis etc.), leave "client" steps active.
    if (step.role === 'agent' && step.auto) {
      await markStep(step.id, {
        status: 'done',
        started_at: step.started_at || new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      continue;
    }
    if (step.role === 'client') {
      // Client steps wait on a person — mark active and stop here.
      await markStep(step.id, { status: 'active', started_at: new Date().toISOString() });
      await sb.from('jobs').update({ current_step: step.order_index }).eq('id', jobId);
      return { advanced: true, reason: 'awaiting client' };
    }

    // First real supplier step — activate it and stop.
    const result = await activateStep({ token, jobId, stepId: step.id });
    await sb.from('jobs').update({ current_step: step.order_index }).eq('id', jobId);
    return result;
  }

  // All steps were already done.
  await sb.from('jobs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', jobId);
  return { advanced: true, reason: 'all steps complete' };
}
