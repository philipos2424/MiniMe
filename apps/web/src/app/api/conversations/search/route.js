/**
 * GET /api/conversations/search?q=query
 * Full-text search across conversations — searches customer names,
 * usernames, and message content.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const q = new URL(request.url).searchParams.get('q')?.trim() || '';
  if (q.length < 2) return NextResponse.json({ results: [] });

  const sb = supabase();

  // 1. Find matching customers (by name or username)
  const { data: matchingCustomers } = await sb.from('customers')
    .select('id, name, telegram_username')
    .eq('business_id', business.id)
    .or(`name.ilike.%${q}%,telegram_username.ilike.%${q}%`)
    .limit(20);

  // 2. Find conversations from matching customers
  const customerIds = (matchingCustomers || []).map(c => c.id);

  // 3. Find matching messages (content search)
  const { data: matchingMessages } = await sb.from('messages')
    .select('conversation_id, content, direction, created_at')
    .eq('business_id', business.id)
    .ilike('content', `%${q}%`)
    .order('created_at', { ascending: false })
    .limit(30);

  const msgConvIds = [...new Set((matchingMessages || []).map(m => m.conversation_id))];

  // 4. Union all conversation IDs
  const allConvIds = [...new Set([...msgConvIds, ...customerIds.map(() => null)])].filter(Boolean);

  // Get all relevant conversations
  let convIdSet = new Set(msgConvIds);

  // Also get convs by customer name match
  if (customerIds.length > 0) {
    const { data: custConvs } = await sb.from('conversations')
      .select('id')
      .eq('business_id', business.id)
      .in('customer_id', customerIds)
      .limit(20);
    (custConvs || []).forEach(c => convIdSet.add(c.id));
  }

  if (convIdSet.size === 0) return NextResponse.json({ results: [], total: 0 });

  // Fetch full conversation data
  const { data: conversations } = await sb.from('conversations')
    .select('id, customer_id, last_message_at, requires_owner, last_ai_action, customers(id, name, telegram_username)')
    .eq('business_id', business.id)
    .in('id', [...convIdSet])
    .order('last_message_at', { ascending: false })
    .limit(20);

  // Build a map of matched message snippets per conversation
  const msgSnippets = {};
  for (const m of matchingMessages || []) {
    if (!msgSnippets[m.conversation_id]) {
      const idx = m.content.toLowerCase().indexOf(q.toLowerCase());
      const start = Math.max(0, idx - 30);
      const snippet = (start > 0 ? '…' : '') + m.content.slice(start, start + 120) + (m.content.length > start + 120 ? '…' : '');
      msgSnippets[m.conversation_id] = { snippet, direction: m.direction, at: m.created_at };
    }
  }

  const results = (conversations || []).map(c => ({
    id: c.id,
    customer_id: c.customers?.id,
    customer_name: c.customers?.name || 'Customer',
    customer_username: c.customers?.telegram_username || null,
    last_message_at: c.last_message_at,
    requires_owner: c.requires_owner,
    match: msgSnippets[c.id] || null,
  }));

  return NextResponse.json({ results, total: results.length });
}
