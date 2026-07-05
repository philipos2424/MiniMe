/**
 * GET /api/admin/businesses/:id/customers/:customerId/journey
 *
 * One customer's full cross-source timeline at this business: searches that
 * mentioned/surfaced them, Market views/clicks, their conversation, and their
 * orders — merged chronologically, plus a computed behavior segment.
 *
 * customers.telegram_id is BIGINT; search_logs.searcher_telegram_id and
 * market_events.tg_user_id are TEXT — joins are done in JS by stringifying
 * the id, matching how demand.js / search-metrics already cross-reference
 * these tables (no live SQL join across the type boundary).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../../../../lib/telegram';
import { isAdmin } from '../../../../../../../../lib/server/admin';
import { supabase } from '../../../../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAID = ['paid', 'fulfilled', 'completed'];

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
  const { data: customer } = await sb.from('customers')
    .select('id, name, telegram_id, total_orders, total_spent, created_at')
    .eq('id', params.customerId).eq('business_id', params.id).maybeSingle();
  if (!customer) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const tgId = customer.telegram_id != null ? String(customer.telegram_id) : null;

  const [searches, marketEvents, referrals, msgRows, orderRows] = await Promise.all([
    tgId ? sb.from('search_logs')
      .select('raw_query, results_count, created_at')
      .eq('searcher_telegram_id', tgId)
      .order('created_at', { ascending: true }).limit(100)
      .then(r => r.data || []) : Promise.resolve([]),
    tgId ? sb.from('market_events')
      .select('event_type, product_id, created_at')
      .eq('tg_user_id', tgId).eq('business_id', params.id)
      .order('created_at', { ascending: true }).limit(100)
      .then(r => r.data || []) : Promise.resolve([]),
    tgId ? sb.from('search_referrals')
      .select('landed, first_message_at, created_at')
      .eq('customer_telegram_id', tgId).eq('business_id', params.id)
      .order('created_at', { ascending: true }).limit(20)
      .then(r => r.data || []) : Promise.resolve([]),
    sb.from('messages')
      .select('direction, created_at')
      .eq('business_id', params.id).eq('customer_id', customer.id)
      .order('created_at', { ascending: true }).limit(500)
      .then(r => r.data || []),
    sb.from('orders')
      .select('total, currency, status, created_at')
      .eq('business_id', params.id).eq('customer_id', customer.id)
      .order('created_at', { ascending: true }).limit(100)
      .then(r => r.data || []),
  ]);

  // Product names for market events, one lookup.
  const productIds = [...new Set(marketEvents.map(m => m.product_id).filter(Boolean))];
  let productNames = {};
  if (productIds.length) {
    const { data: prods } = await sb.from('products').select('id, name').in('id', productIds);
    productNames = Object.fromEntries((prods || []).map(p => [p.id, p.name]));
  }

  const timeline = [
    ...searches.map(s => ({
      type: 'search', at: s.created_at,
      text: s.results_count > 0 ? `🔍 Searched "${s.raw_query}" (${s.results_count} result${s.results_count === 1 ? '' : 's'})` : `❌ Searched "${s.raw_query}" — nothing found`,
    })),
    ...marketEvents.map(m => ({
      type: 'market', at: m.created_at,
      text: m.event_type === 'click_chat'
        ? `🛒 Tapped Order${productNames[m.product_id] ? ` — ${productNames[m.product_id]}` : ''}`
        : m.event_type === 'view_product'
          ? `🛍️ Viewed ${productNames[m.product_id] || 'a product'}`
          : `👀 Opened the Market`,
    })),
    ...referrals.filter(r => r.first_message_at).map(r => ({
      type: 'referral', at: r.first_message_at,
      text: `💬 First message (arrived via search)`,
    })),
    ...orderRows.map(o => ({
      type: 'order', at: o.created_at,
      text: `🛒 Order — ${Number(o.total || 0).toLocaleString()} ${o.currency || 'ETB'} (${o.status || 'new'})`,
    })),
  ]
    .filter(e => e.at)
    .sort((a, b) => new Date(a.at) - new Date(b.at));

  // First inbound message, if any (separate from the timeline events above —
  // used only for segment classification, not shown as its own row since the
  // referral event or first search already anchors "when they showed up").
  const firstInbound = msgRows.find(m => m.direction === 'inbound');
  const hasMessaged = !!firstInbound;
  const hasPaidOrder = orderRows.some(o => PAID.includes((o.status || '').toLowerCase()));

  let intentSegment;
  if (hasPaidOrder) intentSegment = 'buyer';
  else if (hasMessaged) intentSegment = 'warm';
  else intentSegment = 'browser';

  // Repeat vs one-and-done: does activity span more than one calendar day?
  const days = new Set(timeline.map(e => e.at.slice(0, 10)));
  const cadenceSegment = days.size > 1 ? 'repeat' : 'one_and_done';

  return NextResponse.json({
    customer: { id: customer.id, name: customer.name, telegram_id: customer.telegram_id, created_at: customer.created_at },
    segment: { intent: intentSegment, cadence: cadenceSegment },
    timeline,
  });
}
