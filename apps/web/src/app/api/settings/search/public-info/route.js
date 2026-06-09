/**
 * PATCH /api/settings/search/public-info
 *
 * Updates what @minimesearchbot is allowed to share about this business.
 * Body: { products, prices, faqs, address, hours, phone, ai_answers }
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_KEYS = ['products', 'prices', 'faqs', 'address', 'hours', 'phone', 'ai_answers'];

export async function PATCH(request) {
  const initData = request.headers.get('x-telegram-init-data') || '';
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await request.json();
  const updates = {};
  for (const key of ALLOWED_KEYS) {
    if (typeof body[key] === 'boolean') updates[key] = body[key];
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  // Merge with existing
  const { data: existing } = await supabase()
    .from('businesses')
    .select('search_public_info')
    .eq('id', business.id)
    .single();

  const merged = { ...(existing?.search_public_info || {}), ...updates };

  const { error } = await supabase()
    .from('businesses')
    .update({ search_public_info: merged })
    .eq('id', business.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, search_public_info: merged });
}
