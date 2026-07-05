/**
 * GET /api/settings/channel/products
 *
 * Recent products that came in via the channel pipeline (live monitoring,
 * forwarded posts, or back-catalog import) — powers the "Recently imported"
 * list on Settings → Product channel so the owner sees proof it's working,
 * not just a DM they might have missed.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';

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

  const sb = supabase();
  let { data, error } = await sb
    .from('products')
    .select('id, name, price, currency, image_url, created_at')
    .eq('business_id', business.id)
    .eq('source', 'channel')
    .order('created_at', { ascending: false })
    .limit(20);

  // `source` column may not exist yet on older deployments (migration pending).
  if (error?.code === 'PGRST204' || error?.code === '42703') {
    return NextResponse.json({ products: [], migration_pending: true });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ products: data || [] });
}
