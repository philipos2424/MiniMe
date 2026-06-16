/**
 * GET /api/customers — list this business's customers (newest activity first).
 *
 * The dashboard's anon key can't read `customers` after the RLS lockdown, so
 * this server route uses the service role and scopes to the caller's business.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';

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

  const { data } = await supabase()
    .from('customers')
    .select('*')
    .eq('business_id', business.id)
    .order('last_active_at', { ascending: false });

  return NextResponse.json({ customers: data || [] });
}
