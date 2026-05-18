/**
 * GET /api/home/feed — drives the redesigned home (Messages tab).
 * Returns:
 *   - needs_reply: list of conversations that need owner attention
 *   - handled_today: count of AI-sent outbound messages since midnight
 *   - has_any_messages: bool — used to pick state B vs C for new owners
 *   - hours_saved_today: float (messages * 2 min / 60)
 *   - weekly_ai_chats: AI messages in last 7 days
 *   - all_time_ai_chats: total AI messages ever
 *   - hours_saved_week: float
 *   - total_customers: int
 *   - avg_response_min: estimated avg response time in minutes
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  // Ethiopia Standard Time = UTC+3. Align "today" with local midnight, not UTC midnight.
  const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
  const nowEAT = new Date(Date.now() + EAT_OFFSET_MS);
  nowEAT.setUTCHours(0, 0, 0, 0);
  const startOfDay = new Date(nowEAT.getTime() - EAT_OFFSET_MS); // back to UTC
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Conversations needing reply
  const { data: convos } = await sb.from('conversations')
    .select('id, customer_id, last_message_at, requires_owner, last_ai_action, customers(name, telegram_username, telegram_id)')
    .eq('business_id', business.id)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false })
    .limit(20);

  // ── Batched fetch of recent messages — replaces N+1 with a single query ───
  // Pull the latest 3 messages per conversation in one trip, then group in JS.
  const convoIds = (convos || []).map(c => c.id);
  let messagesByConvo = {};
  if (convoIds.length) {
    // Fetch enough rows to have ~3 per conversation. 60 rows for 20 convos is generous.
    const { data: recentMsgs } = await sb.from('messages')
      .select('id, conversation_id, direction, content, created_at, is_ai_generated, status, file_url, file_type, file_name')
      .in('conversation_id', convoIds)
      .order('created_at', { ascending: false })
      .limit(convoIds.length * 4);

    for (const m of recentMsgs || []) {
      if (!messagesByConvo[m.conversation_id]) messagesByConvo[m.conversation_id] = [];
      if (messagesByConvo[m.conversation_id].length < 3) {
        messagesByConvo[m.conversation_id].push(m);
      }
    }
  }

  const needsReply = [];
  for (const c of convos || []) {
    const latest = messagesByConvo[c.id] || [];
    if (!latest.length) continue;
    const last = latest[0];
    const inbound = last.direction === 'inbound' ? last : latest.find(m => m.direction === 'inbound');
    if (!inbound && !c.requires_owner) continue;
    const refMsg = inbound || last;
    const ageHours = (Date.now() - new Date(refMsg.created_at).getTime()) / 3600000;
    const isDraft = last.direction === 'outbound' && (last.status === 'drafted');
    const status = ageHours > 4 ? 'urgent' : c.requires_owner ? 'urgent' : 'pending';
    needsReply.push({
      conversation_id: c.id,
      client_name: c.customers?.name || (c.customers?.telegram_username ? `@${c.customers.telegram_username}` : 'Customer'),
      client_telegram_id: c.customers?.telegram_id || null,
      preview: refMsg.file_url ? `📎 ${refMsg.file_name || 'File attachment'}` : (refMsg.content || '').slice(0, 200),
      has_file: !!refMsg.file_url,
      file_type: refMsg.file_type || null,
      time_ago: timeAgo(refMsg.created_at),
      draft_preview: isDraft ? (last.content || '').slice(0, 180) : null,
      draft_id: isDraft ? last.id : null,   // ← for quick approve
      status,
    });
    if (needsReply.length >= 8) break;
  }

  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // Run all counts + revenue + stock + feedback in parallel
  const [
    { count: handledToday },
    { count: weeklyAiChats },
    { count: allTimeAiChats },
    { count: anyInbound },
    { count: totalCustomers },
    { data: todayOrders },
    { data: stockAlerts },
    { data: feedbackRows },
    { count: paidOrderCount },
  ] = await Promise.all([
    sb.from('messages').select('id', { count: 'exact', head: true })
      .eq('business_id', business.id).eq('direction', 'outbound').eq('is_ai_generated', true)
      .gte('created_at', startOfDay.toISOString()),
    sb.from('messages').select('id', { count: 'exact', head: true })
      .eq('business_id', business.id).eq('direction', 'outbound').eq('is_ai_generated', true)
      .gte('created_at', weekAgo),
    sb.from('messages').select('id', { count: 'exact', head: true })
      .eq('business_id', business.id).eq('direction', 'outbound').eq('is_ai_generated', true),
    sb.from('messages').select('id', { count: 'exact', head: true })
      .eq('business_id', business.id).eq('direction', 'inbound').limit(1),
    sb.from('customers').select('id', { count: 'exact', head: true })
      .eq('business_id', business.id),
    // Today's paid orders for revenue card
    sb.from('orders').select('total, currency')
      .eq('business_id', business.id).eq('status', 'paid')
      .gte('paid_at', startOfDay.toISOString()),
    // Fetch all active products sorted by stock — filter by threshold in JS
    sb.from('products').select('id, name, stock_quantity, low_stock_threshold')
      .eq('business_id', business.id).eq('is_active', true)
      .order('stock_quantity', { ascending: true }).limit(100),
    // Feedback for helpfulness % (last 30 days)
    sb.from('feedback').select('helpful')
      .eq('business_id', business.id).gte('created_at', monthAgo).limit(200),
    // All-time paid orders count (for first-sale milestone)
    sb.from('orders').select('id', { count: 'exact', head: true })
      .eq('business_id', business.id).in('status', ['paid', 'fulfilled']),
  ]);

  // Hours saved: assume 2 min per AI reply saved
  const MINS_PER_CHAT = 2;
  const hoursSavedToday = Math.round(((handledToday || 0) * MINS_PER_CHAT / 60) * 10) / 10;
  const hoursSavedWeek  = Math.round(((weeklyAiChats || 0) * MINS_PER_CHAT / 60) * 10) / 10;

  // Revenue today
  const revenueToday = (todayOrders || []).reduce((s, o) => s + Number(o.total || 0), 0);
  const revenueCurrency = todayOrders?.[0]?.currency || 'ETB';
  const ordersToday = todayOrders?.length || 0;

  // Stock alerts — refine with per-product threshold
  const DEFAULT_THRESHOLD = 10;
  const alertItems = (stockAlerts || []).filter(p => {
    const qty = p.stock_quantity ?? 0;
    const thr = p.low_stock_threshold ?? DEFAULT_THRESHOLD;
    return qty <= thr;
  });
  const outOfStockCount = alertItems.filter(p => (p.stock_quantity ?? 0) <= 0).length;
  const lowStockCount   = alertItems.filter(p => (p.stock_quantity ?? 0) > 0).length;

  // Helpfulness % from owner 👍/👎 feedback (last 30 days, ≥3 responses to show)
  const fbTotal = (feedbackRows || []).length;
  const fbHelpful = (feedbackRows || []).filter(r => r.helpful).length;
  const helpfulPct = fbTotal >= 3 ? Math.round((fbHelpful / fbTotal) * 100) : null;

  // Gamification fields (read-only — updateStreak runs from the bot side)
  const { data: gameRow } = await sb.from('businesses')
    .select('streak_days, longest_streak, achievements, last_active_date')
    .eq('id', business.id).maybeSingle();
  const achievements = Array.isArray(gameRow?.achievements) ? gameRow.achievements : [];
  // Sort by most recent unlock
  const sortedAchievements = [...achievements].sort((a, b) =>
    new Date(b.unlocked_at || 0) - new Date(a.unlocked_at || 0)
  );

  // Avg response time + model split — use agent_thoughts for brain timing,
  // messages table ai_model column for fast-path detection.
  // This replaces the N+1 query with a single aggregate approach.
  let avgResponseMin = null;
  let fastPathCount = 0;
  let brainCount = 0;
  try {
    const [{ data: recentOutbound }, { data: thoughtsWeek }] = await Promise.all([
      sb.from('messages')
        .select('conversation_id, created_at, ai_model')
        .eq('business_id', business.id)
        .eq('direction', 'outbound')
        .eq('is_ai_generated', true)
        .gte('created_at', weekAgo)
        .order('created_at', { ascending: false })
        .limit(100),
      sb.from('agent_thoughts')
        .select('duration_ms')
        .eq('business_id', business.id)
        .gte('created_at', weekAgo)
        .limit(200),
    ]);

    // Fast-path vs brain split
    for (const m of recentOutbound || []) {
      if (m.ai_model === 'agent-brain') brainCount++;
      else if (m.ai_model?.includes('mini')) fastPathCount++;
    }

    // Avg response time from brain thoughts (more accurate than message timestamps)
    if (thoughtsWeek?.length >= 3) {
      const d = thoughtsWeek.map(t => t.duration_ms / 60000);
      avgResponseMin = Math.round((d.reduce((a, b) => a + b, 0) / d.length) * 10) / 10;
    }
  } catch {}

  return NextResponse.json({
    needs_reply: needsReply,
    handled_today: handledToday || 0,
    has_any_messages: (anyInbound || 0) > 0,
    hours_saved_today: hoursSavedToday,
    weekly_ai_chats: weeklyAiChats || 0,
    all_time_ai_chats: allTimeAiChats || 0,
    hours_saved_week: hoursSavedWeek,
    total_customers: totalCustomers || 0,
    avg_response_min: avgResponseMin,
    fast_path_count: fastPathCount,
    brain_count: brainCount,
    revenue_today: revenueToday,
    revenue_currency: revenueCurrency,
    orders_today: ordersToday,
    out_of_stock_count: outOfStockCount,
    low_stock_count: lowStockCount,
    stock_alert_names: alertItems.slice(0, 3).map(p => p.name),
    helpful_pct: helpfulPct,
    feedback_count: fbTotal,
    gamification: {
      streak_days: gameRow?.streak_days || 0,
      longest_streak: gameRow?.longest_streak || 0,
      last_active_date: gameRow?.last_active_date || null,
      achievements_count: achievements.length,
      recent_achievements: sortedAchievements.slice(0, 3),
    },
    channels: {
      telegram:  !!business.telegram_bot_token_enc,
      whatsapp:  !!business.whatsapp_phone_number_id,
      instagram: !!business.instagram_page_id,
      facebook:  !!business.facebook_page_id,
    },
    first_payment: (paidOrderCount || 0) > 0,
  });
}
