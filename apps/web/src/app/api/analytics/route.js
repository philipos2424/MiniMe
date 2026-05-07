/**
 * GET /api/analytics — live analytics computed from raw tables.
 *
 * Skips daily_analytics (empty — no rollup runs) and computes the last 7
 * days directly from messages, orders, customers, jobs.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dayKey(d) { return new Date(d).toISOString().slice(0, 10); }

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();

  const [
    { data: msgs },
    { data: orders },
    { data: newCustomers },
    { data: topCustomers },
    { count: totalCustomers },
    { data: jobs },
    { count: openConversations },
  ] = await Promise.all([
    sb.from('messages').select('direction, is_ai_generated, owner_edited, edit_distance, created_at')
      .eq('business_id', business.id).gte('created_at', since).limit(2000),
    sb.from('orders').select('total, currency, status, created_at')
      .eq('business_id', business.id).gte('created_at', since).limit(500),
    sb.from('customers').select('id, created_at')
      .eq('business_id', business.id).gte('created_at', since).limit(500),
    sb.from('customers').select('id, name, telegram_username, total_spent, total_orders, sentiment_avg, last_active_at')
      .eq('business_id', business.id).order('total_spent', { ascending: false }).limit(5),
    sb.from('customers').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    sb.from('jobs').select('id, status, budget, currency').eq('business_id', business.id).in('status', ['draft', 'active', 'awaiting_approval', 'blocked']),
    sb.from('conversations').select('id', { count: 'exact', head: true }).eq('business_id', business.id).eq('status', 'active'),
  ]);

  // Build a per-day series for the last 7 days (today-back).
  const days = [];
  for (let i = 6; i >= 0; i--) {
    days.push(dayKey(Date.now() - i * 86400000));
  }
  const init = () => ({ total_messages: 0, ai_auto_sent: 0, ai_edited: 0, new_customers: 0, revenue: 0, orders: 0 });
  const byDay = Object.fromEntries(days.map(d => [d, init()]));

  for (const m of msgs || []) {
    const k = dayKey(m.created_at);
    if (!byDay[k]) continue;
    byDay[k].total_messages++;
    if (m.is_ai_generated && m.direction === 'outbound') {
      const wasEdited = m.owner_edited || (m.edit_distance || 0) > 0;
      if (wasEdited) byDay[k].ai_edited++;
      else byDay[k].ai_auto_sent++;
    }
  }
  for (const o of orders || []) {
    const k = dayKey(o.created_at);
    if (!byDay[k]) continue;
    byDay[k].orders++;
    if (['paid', 'fulfilled', 'completed'].includes((o.status || '').toLowerCase())) {
      byDay[k].revenue += Number(o.total) || 0;
    }
  }
  for (const c of newCustomers || []) {
    const k = dayKey(c.created_at);
    if (!byDay[k]) continue;
    byDay[k].new_customers++;
  }

  const weekly = days.map(d => ({ date: d, ...byDay[d] }));

  // Totals
  const totals = weekly.reduce((acc, d) => ({
    messages: acc.messages + d.total_messages,
    aiSent: acc.aiSent + d.ai_auto_sent,
    aiEdited: acc.aiEdited + d.ai_edited,
    newCustomers: acc.newCustomers + d.new_customers,
    revenue: acc.revenue + d.revenue,
    orders: acc.orders + d.orders,
  }), { messages: 0, aiSent: 0, aiEdited: 0, newCustomers: 0, revenue: 0, orders: 0 });

  const aiTotal = totals.aiSent + totals.aiEdited;
  const editRate = aiTotal ? Math.round((totals.aiEdited / aiTotal) * 100) : 0;

  // Pipeline value from open jobs
  const pipeline = {
    ETB: (jobs || []).filter(j => (j.currency || 'ETB') === 'ETB').reduce((s, j) => s + (Number(j.budget) || 0), 0),
    USD: (jobs || []).filter(j => j.currency === 'USD').reduce((s, j) => s + (Number(j.budget) || 0), 0),
  };

  return NextResponse.json({
    weekly,
    totals: {
      ...totals,
      edit_rate_pct: editRate,
      total_customers: totalCustomers || 0,
      open_conversations: openConversations || 0,
      open_jobs: (jobs || []).length,
      pipeline_etb: pipeline.ETB,
      pipeline_usd: pipeline.USD,
    },
    topCustomers: topCustomers || [],
  });
}
