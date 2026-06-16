/**
 * GET /api/messages/recent — last few messages across the business (live feed).
 * ?limit=8 (default, capped at 50)
 *
 * Service role + Telegram initData, scoped to the caller's business. Replaces
 * the dashboard live feed's direct anon read of `messages`.
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

  const limit = Math.min(50, Math.max(1, parseInt(new URL(request.url).searchParams.get('limit') || '8', 10) || 8));

  const { data } = await supabase()
    .from('messages')
    .select('*, customers(name, telegram_username)')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  return NextResponse.json({ events: data || [] });
}
