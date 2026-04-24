/**
 * GET /api/conversations/[id] — conversation + messages for the dashboard.
 *
 * The browser anon key hits RLS and can't read `messages`, so the dashboard
 * goes through this server-side route which uses the service role and checks
 * that the caller owns the business.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findByOwnerTelegramId(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'no business' }, { status: 404 });

  const sb = supabase();
  const { data: conversation } = await sb.from('conversations')
    .select('*, customers(*)')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();

  if (!conversation) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: messages } = await sb.from('messages')
    .select('*')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })
    .limit(200);

  return NextResponse.json({ conversation, messages: messages || [] });
}
