/**
 * Job fan-out engine.
 *
 * When a job is approved by the owner, this module:
 *   1. picks the right supplier for the current step's role,
 *   2. generates a clean supplier brief with GPT-4o,
 *   3. DMs the supplier via the business's Telegram bot,
 *   4. logs the outbound message to job_threads + job_events,
 *   5. advances the step status (waiting/blocked).
 *
 * File-forwarding (client attachments → supplier) is a TODO — v1 mentions
 * in the brief that files will follow.
 */
import OpenAI from 'openai';
import { MODEL } from './constants';
import { supabase } from './db';
import { logEvent, appendThread } from './jobs';
import { tg } from './telegramApi';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  // Pick supplier.
  const supplier = await pickSupplier({ businessId: job.business_id, role: step.role });
  if (!supplier) {
    const reason = `No ${step.role} on team — add one in /agent/team`;
    await markStep(step.id, {
      status: 'blocked',
      started_at: new Date().toISOString(),
      outbound_summary: reason,
    });
    await logEvent(step.job_id, {
      kind: 'blocked',
      icon: '⚠️',
      title: reason,
      body: `Can't send "${step.label}" — add a ${step.role} to your team.`,
      auto: true,
      color: 'amber',
    });
    return { advanced: false, reason: `no ${step.role}` };
  }

  // If we don't have a telegram chat id for them, we can't DM.
  if (!supplier.contact_telegram) {
    const reason = `${supplier.name} has no Telegram ID — add it in /agent/team`;
    await markStep(step.id, {
      status: 'blocked',
      supplier_id: supplier.id,
      started_at: new Date().toISOString(),
      outbound_summary: reason,
    });
    await logEvent(step.job_id, {
      kind: 'blocked',
      icon: '⚠️',
      title: reason,
      body: `Add a numeric Telegram ID for ${supplier.name} so the agent can DM them.`,
      auto: true,
      color: 'amber',
    });
    return { advanced: false, reason: `${supplier.name} has no telegram id` };
  }

  // Grab any files the customer attached in this conversation so we can forward
  // them alongside the brief (reference photos, spec PDFs, etc.).
  let attachments = [];
  if (job.customer_id) {
    const { data: files } = await sb.from('messages')
      .select('telegram_file_id, telegram_file_type, telegram_file_name, content')
      .eq('customer_id', job.customer_id)
      .not('telegram_file_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);
    attachments = files || [];
  }

  // Generate brief + send.
  const briefCore = await generateBrief({ job, step, businessName });
  const brief = attachments.length
    ? `${briefCore}\n\n📎 ${attachments.length} reference file${attachments.length > 1 ? 's' : ''} below.`
    : briefCore;
  const sent = await tg(token, 'sendMessage', {
    chat_id: supplier.contact_telegram,
    text: brief,
  });
  const messageId = sent?.result?.message_id || null;

  // Forward each attachment using Telegram's file_id — no re-download needed.
  for (const att of attachments) {
    try {
      if (att.telegram_file_type === 'photo') {
        await tg(token, 'sendPhoto', {
          chat_id: supplier.contact_telegram,
          photo: att.telegram_file_id,
          caption: att.content?.slice(0, 200) || undefined,
        });
      } else if (att.telegram_file_type === 'document') {
        await tg(token, 'sendDocument', {
          chat_id: supplier.contact_telegram,
          document: att.telegram_file_id,
          caption: att.telegram_file_name || undefined,
        });
      } else if (att.telegram_file_type === 'voice') {
        await tg(token, 'sendVoice', {
          chat_id: supplier.contact_telegram,
          voice: att.telegram_file_id,
        });
      }
    } catch (e) { console.warn('forward attachment:', e.message); }
  }

  await markStep(step.id, {
    supplier_id: supplier.id,
    brief,
    supplier_message_id: messageId,
    status: 'waiting',
    started_at: new Date().toISOString(),
    outbound_summary: brief.slice(0, 200),
  });

  await logEvent(step.job_id, {
    kind: 'auto_sent',
    icon: step.icon || '📨',
    title: `Briefed ${supplier.name} (${step.role})`,
    body: brief.slice(0, 300),
    auto: true,
    color: 'purple',
  });

  try {
    await appendThread(step.job_id, {
      contactType: 'supplier',
      supplierId: supplier.id,
      role: step.role,
      title: `${supplier.name} — ${step.role}`,
      message: { from: 'me', text: brief, auto: true },
    });
  } catch (e) { console.warn('appendThread:', e.message); }

  return { advanced: true, reason: 'supplier briefed' };
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
