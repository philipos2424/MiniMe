/**
 * GET /api/advisor/resolve-client?q=<name>
 * Resolves a client name (or @handle) to their most recent active conversation_id.
 * Used by the Advisor's action buttons to deep-link straight into a chat.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ error: 'q required' }, { status: 400 });

  const sb = supabase();
  const handle = q.replace(/^@/, '').toLowerCase();

  // Try exact name first, then partial, then @handle, then partial handle.
  const { data: customers } = await sb.from('customers')
    .select('id, name, telegram_username, last_active_at')
    .eq('business_id', business.id)
    .or(`name.ilike.${q},name.ilike.%${q}%,telegram_username.ilike.${handle},telegram_username.ilike.%${handle}%`)
    .order('last_active_at', { ascending: false })
    .limit(5);

  const customer = customers?.[0];
  if (!customer) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: conv } = await sb.from('conversations')
    .select('id')
    .eq('business_id', business.id)
    .eq('customer_id', customer.id)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    customer_id: customer.id,
    customer_name: customer.name,
    conversation_id: conv?.id || null,
  });
}
