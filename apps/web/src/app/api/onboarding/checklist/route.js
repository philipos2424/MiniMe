/**
 * GET /api/onboarding/checklist — derive onboarding completion from real data.
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

  const sb = supabase();
  const [
    { count: docCount },
    { count: teamCount },
    { count: productCount },
    { count: convoCount },
    { count: orderCount },
    { count: paidOrderCount },
  ] = await Promise.all([
    sb.from('documents').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    sb.from('suppliers').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    sb.from('products').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    sb.from('conversations').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    sb.from('orders').select('id', { count: 'exact', head: true }).eq('business_id', business.id),
    sb.from('orders').select('id', { count: 'exact', head: true })
      .eq('business_id', business.id)
      .in('status', ['paid', 'fulfilled']),
  ]);

  const dndCfg = business.notification_prefs?.dnd;
  const dndConfigured = !!(dndCfg && (dndCfg.enabled !== undefined));

  return NextResponse.json({
    taught:        (docCount || 0) > 0,
    team:          (teamCount || 0) > 0,
    products:      (productCount || 0) > 0,
    dnd:           dndConfigured,
    links:         !!(business.website || business.instagram || business.portfolio_url),
    first_chat:    (convoCount || 0) > 0,
    first_order:   (orderCount || 0) > 0,
    first_payment: (paidOrderCount || 0) > 0,
  });
}
