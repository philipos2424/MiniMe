/**
 * GET /api/customer-memory — search "what the bot knows" across all customers.
 *
 * Query params:
 *   kind    optional — filter by customer_memory.kind (preference/fact/commitment/note)
 *   search  optional — case-insensitive substring match on content
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

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const search = url.searchParams.get('search');

  let q = supabase()
    .from('customer_memory')
    .select('id, kind, content, source, created_at, customer_id, customers(id, name, telegram_id, phone)')
    .eq('business_id', business.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (kind) q = q.eq('kind', kind);
  if (search) q = q.ilike('content', `%${search}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ memory: data || [] });
}
