/**
 * GET /api/pipeline
 * Returns orders + active jobs grouped by stage for the Kanban view.
 *
 * Stages:
 *   new          — orders just created, not yet acted on (status='pending')
 *   in_progress  — active jobs (status='active' or 'in_progress')
 *   awaiting     — awaiting payment (status='awaiting_payment')
 *   paid         — payment received (status='paid')
 *   fulfilled    — completed (status='fulfilled' or 'completed') — only last 14 days
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolve(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findBusinessForUser(tg.id) : null;
}

function orderToCard(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const title = items.length
    ? items.map(i => `${i.qty || 1}x ${i.name || i.product || 'item'}`).slice(0, 2).join(', ')
    : 'Order';
  return {
    id: o.id,
    type: 'order',
    title,
    customer: o.customers?.name || 'Customer',
    total: Number(o.total || 0),
    currency: o.currency || 'ETB',
    status: o.status,
    created_at: o.created_at,
    paid_at: o.paid_at,
    fulfilled_at: o.fulfilled_at,
  };
}

function jobToCard(j) {
  return {
    id: j.id,
    type: 'job',
    title: j.title || j.summary || 'Service job',
    customer: j.customers?.name || 'Customer',
    total: Number(j.amount || 0),
    currency: j.currency || 'ETB',
    status: j.status,
    current_step: j.current_step,
    total_steps: j.total_steps,
    created_at: j.created_at,
  };
}

export async function GET(request) {
  const business = await resolve(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  const [{ data: orders }, { data: jobs }] = await Promise.all([
    sb.from('orders')
      .select('id, status, total, currency, items, created_at, paid_at, fulfilled_at, customers(name)')
      .eq('business_id', business.id)
      .or(`status.in.(pending,awaiting_payment,paid),fulfilled_at.gte.${fourteenDaysAgo}`)
      .order('created_at', { ascending: false })
      .limit(120),

    sb.from('jobs')
      .select('id, title, summary, status, current_step, total_steps, amount, currency, created_at, customers(name)')
      .eq('business_id', business.id)
      .in('status', ['active', 'in_progress', 'pending'])
      .order('created_at', { ascending: false })
      .limit(60),
  ]);

  const newCol = [];
  const inProgress = [];
  const awaiting = [];
  const paid = [];
  const fulfilled = [];

  for (const o of orders || []) {
    const card = orderToCard(o);
    if (o.status === 'pending') newCol.push(card);
    else if (o.status === 'awaiting_payment') awaiting.push(card);
    else if (o.status === 'paid') paid.push(card);
    else if (o.status === 'fulfilled') fulfilled.push(card);
  }

  for (const j of jobs || []) {
    inProgress.push(jobToCard(j));
  }

  return NextResponse.json({
    new: newCol,
    in_progress: inProgress,
    awaiting,
    paid,
    fulfilled,
    counts: {
      new: newCol.length,
      in_progress: inProgress.length,
      awaiting: awaiting.length,
      paid: paid.length,
      fulfilled: fulfilled.length,
    },
  });
}
