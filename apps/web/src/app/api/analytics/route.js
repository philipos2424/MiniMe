/**
 * GET /api/analytics?period=7d|30d|90d|all
 * Full business analytics — messages, revenue, customers, AI performance,
 * time-of-day patterns, product sales, loyalty breakdown.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';
import { hotProducts, unmetDemand } from '../../../lib/server/demand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dayKey(d) { return new Date(d).toISOString().slice(0, 10); }
function hourOf(d) { return new Date(d).getUTCHours(); } // EAT = UTC+3

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || '7d';
  const days = period === '30d' ? 30 : period === '90d' ? 90 : period === 'all' ? 730 : 7;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const sb = supabase();

  const [
    { data: msgs },
    { data: orders },
    { data: newCustomers },
    { data: allCustomers },
    { data: jobs },
    { data: feedback },
    { data: products },
  ] = await Promise.all([
    // All messages in period
    sb.from('messages')
      .select('direction, is_ai_generated, owner_edited, created_at, content')
      .eq('business_id', business.id)
      .gte('created_at', since)
      .limit(10000),

    // All orders in period
    sb.from('orders')
      .select('total, currency, status, created_at, paid_at, items, customer_id')
      .eq('business_id', business.id)
      .gte('created_at', since)
      .limit(2000),

    // New customers in period
    sb.from('customers')
      .select('id, created_at, tier, loyalty_points')
      .eq('business_id', business.id)
      .gte('created_at', since),

    // All customers ever (for totals & loyalty breakdown)
    sb.from('customers')
      .select('id, name, total_spent, total_orders, last_active_at, tier, loyalty_points, telegram_username')
      .eq('business_id', business.id)
      .order('total_spent', { ascending: false })
      .limit(200),

    // Active jobs
    sb.from('jobs')
      .select('id, status, budget, currency, created_at')
      .eq('business_id', business.id)
      .gte('created_at', since),

    // Feedback ratings
    sb.from('feedback')
      .select('helpful, rating, created_at')
      .eq('business_id', business.id)
      .gte('created_at', since),

    // Products for revenue analysis
    sb.from('products')
      .select('id, name, price, currency, stock_quantity')
      .eq('business_id', business.id)
      .eq('is_active', true),
  ]);

  // Previous period for week-over-week comparison
  const prevSince = new Date(Date.now() - days * 2 * 86400000).toISOString();
  const [{ data: prevMsgs }, { data: prevOrders }] = await Promise.all([
    sb.from('messages')
      .select('direction, is_ai_generated, created_at')
      .eq('business_id', business.id)
      .gte('created_at', prevSince)
      .lt('created_at', since),
    sb.from('orders')
      .select('total, status, created_at')
      .eq('business_id', business.id)
      .gte('created_at', prevSince)
      .lt('created_at', since),
  ]);

  // ── Day-by-day series ──────────────────────────────────────────────────────
  const dayList = [];
  for (let i = Math.min(days - 1, 89); i >= 0; i--) {
    dayList.push(dayKey(Date.now() - i * 86400000));
  }
  const initDay = () => ({ messages: 0, ai_sent: 0, edited: 0, inbound: 0, revenue: 0, orders: 0, new_customers: 0 });
  const byDay = Object.fromEntries(dayList.map(d => [d, initDay()]));

  for (const m of msgs || []) {
    const k = dayKey(m.created_at);
    if (!byDay[k]) continue;
    byDay[k].messages++;
    if (m.direction === 'inbound') byDay[k].inbound++;
    if (m.is_ai_generated && m.direction === 'outbound') {
      if (m.owner_edited) byDay[k].edited++;
      else byDay[k].ai_sent++;
    }
  }
  for (const o of orders || []) {
    const k = dayKey(o.created_at);
    if (!byDay[k]) continue;
    byDay[k].orders++;
    if (['paid', 'fulfilled'].includes(o.status)) byDay[k].revenue += Number(o.total || 0);
  }
  for (const c of newCustomers || []) {
    const k = dayKey(c.created_at);
    if (byDay[k]) byDay[k].new_customers++;
  }

  const series = dayList.map(d => ({ date: d, ...byDay[d] }));

  // ── Hour-of-day breakdown (EAT = UTC+3) ───────────────────────────────────
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: (h + 3) % 24, messages: 0, ai_sent: 0 }));
  for (const m of msgs || []) {
    const eatHour = (hourOf(m.created_at) + 3) % 24;
    byHour[eatHour].messages++;
    if (m.is_ai_generated && m.direction === 'outbound' && !m.owner_edited) byHour[eatHour].ai_sent++;
  }

  // ── Day-of-week breakdown ─────────────────────────────────────────────────
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const byDow = Array.from({ length: 7 }, (_, i) => ({ day: DOW[i], messages: 0 }));
  for (const m of msgs || []) {
    const d = new Date(m.created_at).getUTCDay();
    byDow[d].messages++;
  }

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totalInbound    = (msgs || []).filter(m => m.direction === 'inbound').length;
  const totalAiSent     = (msgs || []).filter(m => m.is_ai_generated && m.direction === 'outbound' && !m.owner_edited).length;
  const totalEdited     = (msgs || []).filter(m => m.owner_edited).length;
  const totalAiTotal    = totalAiSent + totalEdited;
  const editRate        = totalAiTotal > 0 ? Math.round((totalEdited / totalAiTotal) * 100) : 0;
  const accuracy        = Math.max(0, 100 - editRate);
  const hoursSaved      = Math.round((totalAiSent * 2 / 60) * 10) / 10;

  const paidOrders      = (orders || []).filter(o => ['paid', 'fulfilled'].includes(o.status));
  const totalRevenue    = paidOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const avgOrderValue   = paidOrders.length > 0 ? Math.round(totalRevenue / paidOrders.length) : 0;
  // Customer lifetime value = total revenue / unique paying customers
  const uniquePayers    = new Set(paidOrders.map(o => o.customer_id).filter(Boolean)).size;
  const avgLtv          = uniquePayers > 0 ? Math.round(totalRevenue / uniquePayers) : 0;
  const totalOrders     = (orders || []).length;
  const currency        = paidOrders[0]?.currency || 'ETB';

  const totalCustomers  = (allCustomers || []).length;
  const newCustCount    = (newCustomers || []).length;
  const activeCustomers = (allCustomers || []).filter(c => c.last_active_at && new Date(c.last_active_at) > new Date(since)).length;

  // Loyalty tier breakdown
  const tierBreakdown = { gold: 0, silver: 0, bronze: 0, other: 0 };
  for (const c of allCustomers || []) {
    const t = c.tier || 'other';
    if (t in tierBreakdown) tierBreakdown[t]++;
    else tierBreakdown.other++;
  }

  // Feedback
  const fbTotal   = (feedback || []).length;
  const fbHelpful = (feedback || []).filter(r => r.helpful).length;
  const helpfulPct = fbTotal >= 3 ? Math.round((fbHelpful / fbTotal) * 100) : null;
  const avgRating  = fbTotal > 0
    ? Math.round(((feedback || []).reduce((s, r) => s + (r.rating || 0), 0) / fbTotal) * 10) / 10
    : null;

  // Pipeline
  const pipelineEtb = (jobs || []).filter(j => (j.currency || 'ETB') === 'ETB' && ['active', 'pending'].includes(j.status)).reduce((s, j) => s + Number(j.budget || 0), 0);

  // Top customers
  const topCustomers = (allCustomers || []).slice(0, 10).map(c => ({
    id: c.id,
    name: c.name || 'Customer',
    username: c.telegram_username || null,
    total_spent: c.total_spent || 0,
    total_orders: c.total_orders || 0,
    tier: c.tier || 'bronze',
    loyalty_points: c.loyalty_points || 0,
    last_active: c.last_active_at,
  }));

  // Repeat vs new customers (by order history)
  const ordersByCustomer = {};
  for (const o of orders || []) {
    if (!o.customer_id) continue;
    ordersByCustomer[o.customer_id] = (ordersByCustomer[o.customer_id] || 0) + 1;
  }
  const repeatOrderers = Object.values(ordersByCustomer).filter(n => n > 1).length;
  const repeatRate = Object.keys(ordersByCustomer).length > 0
    ? Math.round((repeatOrderers / Object.keys(ordersByCustomer).length) * 100)
    : 0;

  // Busiest hour
  const busiestHour = [...byHour].sort((a, b) => b.messages - a.messages)[0];
  const busiestDay  = [...byDow].sort((a, b) => b.messages - a.messages)[0];

  // ── Stock velocity (units sold per day × days of stock remaining) ─────────
  const productSales = {};
  for (const o of orders || []) {
    if (!['paid', 'fulfilled'].includes(o.status)) continue;
    for (const item of Array.isArray(o.items) ? o.items : []) {
      const name = item.name || item.product || '';
      if (!name) continue;
      if (!productSales[name]) productSales[name] = 0;
      productSales[name] += (item.qty || 1);
    }
  }
  // Match to actual products and compute days of stock remaining
  const velocityAlerts = (products || [])
    .filter(p => (p.stock_quantity ?? 0) > 0)
    .map(p => {
      const sold = productSales[p.name] || 0;
      const dailySales = sold / Math.max(days, 1);
      const daysLeft = dailySales > 0 ? Math.floor((p.stock_quantity ?? 0) / dailySales) : null;
      return { name: p.name, stock: p.stock_quantity ?? 0, sold, daily_rate: Math.round(dailySales * 10) / 10, days_left: daysLeft };
    })
    .filter(p => p.days_left !== null && p.days_left <= 7 && p.sold > 0) // running out in 7 days
    .sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999))
    .slice(0, 5);

  // ── Top products by revenue ────────────────────────────────────────────────
  const productRevenue = {};
  for (const o of orders || []) {
    if (!['paid', 'fulfilled'].includes(o.status)) continue;
    const items = Array.isArray(o.items) ? o.items : [];
    for (const item of items) {
      const name = item.name || item.product || 'Unknown';
      if (!productRevenue[name]) productRevenue[name] = { name, revenue: 0, orders: 0 };
      productRevenue[name].revenue += (item.price || 0) * (item.qty || 1);
      productRevenue[name].orders++;
    }
  }
  const topProducts = Object.values(productRevenue)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 8)
    .map(p => ({ ...p, revenue: Math.round(p.revenue) }));

  // ── Marketplace demand for THIS business (views + order taps) ─────────────
  // One grouped fetch on market_events — shows the merchant that MiniMe Market
  // is sending them attention even before it turns into chats/orders.
  let marketViews = 0, marketClicks = 0;
  try {
    const sinceIso = new Date(Date.now() - days * 86400000).toISOString();
    const { data: mktEvents } = await supabase()
      .from('market_events')
      .select('event_type')
      .eq('business_id', business.id)
      .in('event_type', ['view_product', 'click_chat'])
      .gte('created_at', sinceIso)
      .limit(10000);
    for (const e of mktEvents || []) {
      if (e.event_type === 'click_chat') marketClicks++; else marketViews++;
    }
  } catch (e) { console.warn('[analytics] market events failed:', e.message); }

  // ── Market intelligence: which of THEIR products people look at, and what
  // shoppers search for that they could stock/add. Turns MiniMe Market from an
  // abstract promise into concrete, actionable proof. Best-effort — never block
  // the core analytics response.
  let marketHot = [], marketGaps = [];
  try {
    [marketHot, marketGaps] = await Promise.all([
      hotProducts({ businessId: business.id, days, limit: 5 }),
      unmetDemand({ days: 30, limit: 6, category: business.category || null }),
    ]);
  } catch (e) { console.warn('[analytics] market intel failed:', e.message); }

  // ── Previous period totals (for % change) ──────────────────────────────────
  const prevInbound  = (prevMsgs || []).filter(m => m.direction === 'inbound').length;
  const prevAiSent   = (prevMsgs || []).filter(m => m.is_ai_generated && m.direction === 'outbound').length;
  const prevRevenue  = (prevOrders || []).filter(o => ['paid', 'fulfilled'].includes(o.status)).reduce((s, o) => s + Number(o.total || 0), 0);
  const prevOrderCnt = (prevOrders || []).length;

  function pctChange(curr, prev) {
    if (!prev) return curr > 0 ? 100 : 0;
    return Math.round(((curr - prev) / prev) * 100);
  }

  return NextResponse.json({
    period,
    days,
    series,
    hour_breakdown: byHour,
    dow_breakdown: byDow,
    totals: {
      messages: totalInbound,
      ai_sent: totalAiSent,
      ai_total: totalAiTotal,
      edit_rate_pct: editRate,
      accuracy_pct: accuracy,
      hours_saved: hoursSaved,
      revenue: totalRevenue,
      orders: totalOrders,
      paid_orders: paidOrders.length,
      avg_order_value: avgOrderValue,
      avg_lifetime_value: avgLtv,
      currency,
      customers_total: totalCustomers,
      customers_new: newCustCount,
      customers_active: activeCustomers,
      repeat_rate_pct: repeatRate,
      pipeline_etb: pipelineEtb,
      feedback_count: fbTotal,
      helpful_pct: helpfulPct,
      avg_rating: avgRating,
      market_views: marketViews,
      market_clicks: marketClicks,
    },
    market: {
      views: marketViews,
      clicks: marketClicks,
      hot_products: marketHot,   // their items shoppers are viewing/tapping
      unmet_demand: marketGaps,  // searches with no match — gaps to fill
    },
    tier_breakdown: tierBreakdown,
    busiest: {
      hour: busiestHour,
      day: busiestDay,
    },
    topCustomers,
    topProducts,
    velocity_alerts: velocityAlerts,
    prev_period: {
      messages: prevInbound,
      ai_sent: prevAiSent,
      revenue: Math.round(prevRevenue),
      orders: prevOrderCnt,
    },
    pct_change: {
      messages:  pctChange(totalInbound, prevInbound),
      ai_sent:   pctChange(totalAiSent, prevAiSent),
      revenue:   pctChange(Math.round(totalRevenue), Math.round(prevRevenue)),
      orders:    pctChange(totalOrders, prevOrderCnt),
    },
  });
}
