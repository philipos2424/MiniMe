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
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
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
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Conversations needing reply
  const { data: convos } = await sb.from('conversations')
    .select('id, customer_id, last_message_at, requires_owner, last_ai_action, customers(name, telegram_username, telegram_id)')
    .eq('business_id', business.id)
    .eq('status', 'active')
    .order('last_message_at', { ascending: false })
    .limit(20);

  const needsReply = [];
  for (const c of convos || []) {
    const { data: latest } = await sb.from('messages')
      .select('direction, content, created_at, is_ai_generated, status, file_url, file_type, file_name')
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(2);
    if (!latest?.length) continue;
    const last = latest[0];
    if (last.direction !== 'inbound') continue;
    const ageHours = (Date.now() - new Date(last.created_at).getTime()) / 3600000;
    const status = ageHours > 4 ? 'urgent' : c.requires_owner ? 'urgent' : 'pending';
    needsReply.push({
      conversation_id: c.id,
      client_name: c.customers?.name || (c.customers?.telegram_username ? `@${c.customers.telegram_username}` : 'Customer'),
      client_telegram_id: c.customers?.telegram_id || null,
      preview: last.file_url ? `📎 ${last.file_name || 'File attachment'}` : (last.content || '').slice(0, 200),
      has_file: !!last.file_url,
      file_type: last.file_type || null,
      time_ago: timeAgo(last.created_at),
      status,
    });
    if (needsReply.length >= 8) break;
  }

  // Run all counts in parallel
  const [
    { count: handledToday },
    { count: weeklyAiChats },
    { count: allTimeAiChats },
    { count: anyInbound },
    { count: totalCustomers },
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
  ]);

  // Hours saved: assume 2 min per AI reply saved = ~2 minutes of typing/thinking
  const MINS_PER_CHAT = 2;
  const hoursSavedToday = Math.round(((handledToday || 0) * MINS_PER_CHAT / 60) * 10) / 10;
  const hoursSavedWeek  = Math.round(((weeklyAiChats || 0) * MINS_PER_CHAT / 60) * 10) / 10;

  return NextResponse.json({
    needs_reply: needsReply,
    handled_today: handledToday || 0,
    has_any_messages: (anyInbound || 0) > 0,
    hours_saved_today: hoursSavedToday,
    weekly_ai_chats: weeklyAiChats || 0,
    all_time_ai_chats: allTimeAiChats || 0,
    hours_saved_week: hoursSavedWeek,
    total_customers: totalCustomers || 0,
  });
}
