/**
 * PATCH /api/customers/[id]
 * Body: { name: string }
 * Renames a customer record — owner only, scoped to their business.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim();
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (name.length > 80) return NextResponse.json({ error: 'name too long' }, { status: 400 });

  const sb = supabase();

  const { data: existing } = await sb.from('customers')
    .select('id, meta')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { data: customer, error } = await sb.from('customers')
    .update({ name, meta: { ...(existing.meta || {}), renamed_by_owner: true } })
    .eq('id', params.id)
    .eq('business_id', business.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ customer });
}