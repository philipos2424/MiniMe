/**
 * Jobs service — orchestration layer on top of the jobs/job_steps/job_threads/job_events tables.
 *
 * Used by:
 *   - /api/agent/jobs        (list, create, demo-seed)
 *   - /api/agent/jobs/[id]   (detail fetch)
 *   - replyEngine.js later   (when we auto-create jobs from client messages)
 */
import { supabase } from './db';

export async function listJobs(businessId, { status, limit = 30 } = {}) {
  const sb = supabase();
  let q = sb.from('jobs').select('*, customers(name, telegram_username)')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) { console.error('listJobs:', error.message); return []; }
  return data || [];
}

export async function findJobById(id) {
  const sb = supabase();
  const [{ data: job }, { data: steps }, { data: threads }, { data: events }] = await Promise.all([
    sb.from('jobs').select('*, customers(id, name, telegram_username, telegram_id)').eq('id', id).single(),
    sb.from('job_steps').select('*, suppliers(name, contact_telegram)').eq('job_id', id).order('order_index'),
    sb.from('job_threads').select('*, customers(name), suppliers(name)').eq('job_id', id).order('created_at'),
    sb.from('job_events').select('*').eq('job_id', id).order('created_at', { ascending: false }).limit(200),
  ]);
  if (!job) return null;
  return { ...job, steps: steps || [], threads: threads || [], events: events || [] };
}

export async function createJob({ businessId, customerId, conversationId, title, description, deadline, budget, currency = 'ETB', steps = [], clientSnapshot = {} }) {
  const sb = supabase();
  const { data: job, error } = await sb.from('jobs').insert({
    business_id: businessId,
    customer_id: customerId || null,
    conversation_id: conversationId || null,
    title, description, deadline, budget, currency,
    client_snapshot: clientSnapshot,
    status: 'draft',
  }).select().single();
  if (error) { console.error('createJob:', error.message); return null; }

  if (steps.length) {
    const rows = steps.map((s, i) => ({
      job_id: job.id,
      order_index: i,
      label: s.label,
      icon: s.icon || '•',
      role: s.role || 'agent',
      auto: s.auto !== false,
      status: 'idle',
    }));
    await sb.from('job_steps').insert(rows);
  }

  await logEvent(job.id, {
    kind: 'created', icon: '📥', title: 'Job created', body: description || title, auto: false, color: 'blue',
  });
  return job;
}

export async function logEvent(jobId, { kind, icon, title, body, auto = true, color = 'green' }) {
  try {
    await supabase().from('job_events').insert({ job_id: jobId, kind, icon, title, body, auto, color });
  } catch (e) { console.warn('logEvent:', e.message); }
}

export async function advanceStep(jobId, stepIndex, updates) {
  const sb = supabase();
  await sb.from('job_steps').update(updates)
    .eq('job_id', jobId).eq('order_index', stepIndex);
  if (updates.status === 'done') {
    await sb.from('jobs').update({ current_step: stepIndex + 1 }).eq('id', jobId);
  }
}

export async function appendThread(jobId, { contactType, customerId, supplierId, role, title, message }) {
  const sb = supabase();
  const { data: existing } = await sb.from('job_threads').select('*')
    .eq('job_id', jobId)
    .eq('contact_type', contactType)
    .eq(contactType === 'customer' ? 'customer_id' : 'supplier_id', contactType === 'customer' ? customerId : supplierId)
    .maybeSingle();

  const ts = new Date().toISOString();
  const newMsg = { ...message, time: message.time || ts };

  if (existing) {
    await sb.from('job_threads').update({
      messages: [...(existing.messages || []), newMsg],
      last_message_at: ts,
    }).eq('id', existing.id);
    return existing.id;
  } else {
    const { data } = await sb.from('job_threads').insert({
      job_id: jobId,
      contact_type: contactType,
      customer_id: customerId || null,
      supplier_id: supplierId || null,
      role,
      title,
      messages: [newMsg],
      last_message_at: ts,
    }).select().single();
    return data?.id;
  }
}

/**
 * Seed a demo job so a brand-new dashboard has something to look at.
 * Idempotent — returns the existing demo if one already exists for this business.
 */
export async function seedDemoJob(businessId) {
  const sb = supabase();
  const { data: existing } = await sb.from('jobs').select('id')
    .eq('business_id', businessId)
    .contains('payload', { demo: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const demoSteps = [
    { label: 'Client order received', icon: '📥', role: 'client', auto: false, status: 'done' },
    { label: 'Agent analyzed the job', icon: '🧠', role: 'agent', auto: true, status: 'done' },
    { label: 'Brief designer',         icon: '🎨', role: 'designer', auto: true, status: 'done' },
    { label: 'Design approved',        icon: '✅', role: 'client', auto: false, status: 'done' },
    { label: 'Send to printer',        icon: '🖨️', role: 'printer', auto: true, status: 'active' },
    { label: 'Arrange delivery',       icon: '🚚', role: 'delivery', auto: true, status: 'idle' },
    { label: 'Notify client',          icon: '🎉', role: 'client', auto: true, status: 'idle' },
  ];

  const { data: job } = await sb.from('jobs').insert({
    business_id: businessId,
    title: 'Sample gala event — branded materials',
    description: '200 programs, 50 table cards, 10 roll-up banners. Friday deadline.',
    budget: 45000, actual_cost: 40300, currency: 'ETB',
    status: 'active', current_step: 4,
    deadline: new Date(Date.now() + 3 * 86400000).toISOString(),
    client_snapshot: { name: 'Romina PLC', contact: 'Dawit Bekele' },
    payload: { demo: true },
  }).select().single();
  if (!job) return null;

  await sb.from('job_steps').insert(demoSteps.map((s, i) => ({
    job_id: job.id, order_index: i, ...s,
    started_at: i <= 4 ? new Date(Date.now() - (5 - i) * 3600_000).toISOString() : null,
    completed_at: s.status === 'done' ? new Date(Date.now() - (5 - i) * 3600_000 + 600_000).toISOString() : null,
  })));

  const demoEvents = [
    { kind: 'analyzed',  icon: '🧠', title: 'Agent understood the job',       body: 'Parsed: 3 item types, 3 suppliers, 45,000 ETB budget, 3-day deadline.', auto: true, color: 'green' },
    { kind: 'auto_sent', icon: '📨', title: 'Auto-replied to Romina PLC',      body: 'Confirmed job, promised design preview within 4 hours.',              auto: true, color: 'green' },
    { kind: 'auto_sent', icon: '🎨', title: 'Briefed designer',               body: 'Sent spec + budget 8,000 ETB, requested mockups by 1pm.',             auto: true, color: 'purple' },
    { kind: 'received',  icon: '✅', title: 'Designer sent mockups',          body: 'Yared delivered 3 versions ahead of schedule.',                       auto: false, color: 'purple' },
    { kind: 'auto_sent', icon: '👁️', title: 'Forwarded designs to client',    body: '3 versions sent, 3pm approval deadline set.',                         auto: true, color: 'blue' },
    { kind: 'received',  icon: '👍', title: 'Client approved version 2',      body: 'Small font change requested on program.',                             auto: false, color: 'blue' },
    { kind: 'auto_sent', icon: '🔄', title: 'Revision routed to designer',    body: 'Final print-ready files received within the hour.',                   auto: true, color: 'purple' },
    { kind: 'auto_sent', icon: '🖨️', title: 'Print job sent to printer',      body: 'Files + spec sent to Abebe. Awaiting price confirmation.',            auto: true, color: 'amber' },
  ];
  await sb.from('job_events').insert(demoEvents.map(e => ({ job_id: job.id, ...e })));

  await sb.from('job_threads').insert([
    {
      job_id: job.id, contact_type: 'customer', role: 'client',
      title: 'Dawit Bekele — Romina PLC',
      messages: [
        { from: 'them', text: 'Hi! We need branded materials for our gala this Friday. 200 programs, 50 table cards, 10 banners. Budget 45,000 ETB. Can you handle this?', time: '9:14 AM' },
        { from: 'me',   text: "Absolutely — I'm coordinating everything now. Design preview in 4 hours.", time: '9:15 AM', auto: true },
        { from: 'me',   text: 'Design mockups ready — 3 versions attached. Please confirm by 3pm to hit Friday.', time: '12:29 PM', auto: true, attach: 'mockups.pdf' },
        { from: 'them', text: 'Version 2 looks great, approved ✅ Slightly larger date font on programs please.', time: '1:17 PM' },
      ],
      last_message_at: new Date().toISOString(),
    },
  ]);

  return job.id;
}
