/**
 * GET    /api/admin/businesses/:id — full tenant detail
 * PATCH  /api/admin/businesses/:id — update plan / status / panic / trial
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { isAdmin } from '../../../../../lib/server/admin';
import { supabase } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function gate(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return isAdmin(tg?.id) ? tg : null;
}

export async function GET(request, { params }) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabase();
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: business } = await sb.from('businesses').select('*').eq('id', params.id).maybeSingle();
  if (!business) return NextResponse.json({ error: 'not_found' }, { status: 404 });

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
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabase();
  let body = {};
  try { body = await request.json(); } catch {}

  const updates = {};
  const allowed = ['plan_tier', 'subscription_status', 'subscription_plan', 'panic_mode', 'brain_mode', 'trust_level'];
  for (const k of allowed) if (k in body) updates[k] = body[k];

  // Trial extension: { extend_trial_days: 14 }
  if (Number.isFinite(Number(body.extend_trial_days)) && Number(body.extend_trial_days) > 0) {
    const days = Math.min(365, Number(body.extend_trial_days));
    const { data: cur } = await sb.from('businesses').select('trial_ends_at').eq('id', params.id).single();
    const base = cur?.trial_ends_at && new Date(cur.trial_ends_at) > new Date() ? new Date(cur.trial_ends_at) : new Date();
    base.setDate(base.getDate() + days);
    updates.trial_ends_at = base.toISOString();
  }

  if (typeof body.subscription_expires_at === 'string') updates.subscription_expires_at = body.subscription_expires_at;

  if (!Object.keys(updates).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  const { data, error } = await sb.from('businesses').update(updates).eq('id', params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, business: data });
}

export async function DELETE(request, { params }) {
  if (!await gate(request)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sb = supabase();
  const { error } = await sb.from('businesses').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
