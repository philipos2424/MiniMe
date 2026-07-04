/**
 * GET    /api/admin/businesses/:id — full tenant detail
 * PATCH  /api/admin/businesses/:id — update plan / status / panic / trial
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { isAdmin } from '../../../../../lib/server/admin';
import { supabase } from '../../../../../lib/server/db';
import { str, oneOf, num } from '../../../../../lib/server/sanitize';
import { audit } from '../../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id) ? tg : null;
}

export async function GET(request, { params }) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabase();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: business } = await sb.from('businesses').select('*').eq('id', params.id).maybeSingle();
  if (!business) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // GDPR accountability (Art. 5(2)): this view exposes another tenant's full
  // record, including whatever customer stats it aggregates below — log the
  // access itself, not just admin writes. Fire-and-forget: never slow down
  // or fail the read for the audit trail.
  audit({
    business_id: params.id,
    actor_type: 'platform_admin',
    actor_id: admin.id,
    action: 'admin.business_viewed',
    resource_type: 'business',
    resource_id: params.id,
    request,
  }).catch(() => {});

  const [
    { count: msgsWeek },
    { count: convosTotal },
    { count: customersTotal },
    { count: ordersWeek },
    { data: paidOrders },
    { count: jobsActive },
    { count: lessonsWeek },
    { count: docsTotal },
    { count: teamCount },
  ] = await Promise.all([
    sb.from('messages').select('id', { count: 'exact', head: true }).eq('business_id', business.id).gte('created_at', weekAgo),
    sb.from('conversations').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    sb.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    sb.from('orders').select('id', { count: 'exact', head: true }).eq('business_id', business.id).gte('created_at', weekAgo),
    sb.from('orders').select('total, status').eq('business_id', business.id).gte('created_at', weekAgo).limit(500),
    sb.from('jobs').select('id', { count: 'exact', head: true }).eq('business_id', business.id).in('status', ['draft', 'active', 'awaiting_approval', 'blocked']),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('business_id', business.id).eq('tag', 'auto-learned').gte('created_at', weekAgo),
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    sb.from('suppliers').select('id', { count: 'exact', head: true }).eq('business_id', business.id).eq('is_active', true),
  ]);

  const revenue = (paidOrders || []).filter(o => ['paid', 'fulfilled', 'completed'].includes((o.status || '').toLowerCase())).reduce((s, o) => s + Number(o.total || 0), 0);

  return NextResponse.json({
    business,
    stats: {
      msgs_week: msgsWeek || 0,
      convos_total: convosTotal || 0,
      customers_total: customersTotal || 0,
      orders_week: ordersWeek || 0,
      revenue_week: revenue,
      jobs_active: jobsActive || 0,
      lessons_week: lessonsWeek || 0,
      docs_total: docsTotal || 0,
      team_count: teamCount || 0,
    },
  });
}

export async function PATCH(request, { params }) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabase();
  let body = {};
  try { body = await request.json(); } catch {}

  const updates = {};
  const planTiers = ['free', 'starter', 'pro', 'business', 'enterprise'];

  // Validate and sanitize every allowed field — even admin inputs get bounds checks
  try {
    if ('plan_tier' in body)
      updates.plan_tier = oneOf(body.plan_tier, planTiers, { field: 'plan_tier' });
    if ('subscription_status' in body)
      updates.subscription_status = oneOf(body.subscription_status, ['trial', 'active', 'cancelled', 'expired', 'pending_review'], { field: 'subscription_status' });
    if ('subscription_plan' in body)
      updates.subscription_plan = oneOf(body.subscription_plan, planTiers, { field: 'subscription_plan' });
    if ('panic_mode' in body)     updates.panic_mode   = !!body.panic_mode;
    if ('brain_mode' in body)     updates.brain_mode   = !!body.brain_mode;
    if ('trust_level' in body)    updates.trust_level  = num(body.trust_level, { field: 'trust_level', min: 0, max: 3, integer: true });
    if ('payment_verified' in body) updates.payment_verified = !!body.payment_verified;
    if ('verified' in body) {
      updates.verified = !!body.verified;
      updates.verified_at = body.verified ? new Date().toISOString() : null;
    }
    if ('payment_ref' in body)    updates.payment_ref  = str(body.payment_ref,   { field: 'payment_ref',   max: 200, required: false });
    if ('payment_notes' in body)  updates.payment_notes= str(body.payment_notes, { field: 'payment_notes', max: 1000, required: false });
    if ('owner_name' in body)     updates.owner_name   = str(body.owner_name,    { field: 'owner_name',    max: 100, required: false, stripHtml: true });
    if ('owner_phone' in body)    updates.owner_phone  = str(body.owner_phone,   { field: 'owner_phone',   max: 30, required: false });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  // Keep plan_tier and subscription_plan in sync — set both when either changes
  if ('plan_tier' in body && !('subscription_plan' in body)) updates.subscription_plan = body.plan_tier;
  if ('subscription_plan' in body && !('plan_tier' in body)) updates.plan_tier = body.subscription_plan;

  // Trial extension: { extend_trial_days: 14 }
  if (Number.isFinite(Number(body.extend_trial_days)) && Number(body.extend_trial_days) > 0) {
    const days = Math.min(365, Number(body.extend_trial_days));
    const { data: cur } = await sb.from('businesses').select('trial_ends_at').eq('id', params.id).single();
    const base = cur?.trial_ends_at && new Date(cur.trial_ends_at) > new Date() ? new Date(cur.trial_ends_at) : new Date();
    base.setDate(base.getDate() + days);
    updates.trial_ends_at = base.toISOString();
  }

  // Direct trial_ends_at setter: { trial_ends_at: "2026-06-01" }
  if (typeof body.trial_ends_at === 'string' && body.trial_ends_at) {
    const d = new Date(body.trial_ends_at);
    if (!isNaN(d.getTime())) updates.trial_ends_at = d.toISOString();
  }

  if (typeof body.subscription_expires_at === 'string') updates.subscription_expires_at = body.subscription_expires_at;

  if (!Object.keys(updates).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  const { data, error } = await sb.from('businesses').update(updates).eq('id', params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit({
    business_id: params.id,
    actor_type: 'platform_admin',
    actor_id: admin.id,
    action: 'admin.business_updated',
    resource_type: 'business',
    resource_id: params.id,
    metadata: { updated_fields: Object.keys(updates), updates },
    request,
  });
  return NextResponse.json({ ok: true, business: data });
}

export async function DELETE(request, { params }) {
  const admin = await gate(request);
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabase();
  const { data: business } = await sb.from('businesses').select('id, name, owner_telegram_id, telegram_bot_username').eq('id', params.id).maybeSingle();
  if (!business) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await audit({
    business_id: params.id,
    actor_type: 'platform_admin',
    actor_id: admin.id,
    action: 'admin.business_deleted',
    resource_type: 'business',
    resource_id: params.id,
    metadata: {
      name: business.name,
      owner_telegram_id: business.owner_telegram_id,
      telegram_bot_username: business.telegram_bot_username,
    },
    request,
  });
  const { error } = await sb.from('businesses').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
