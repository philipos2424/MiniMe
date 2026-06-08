/**
 * PATCH /api/discounts/[id] — toggle is_active, update fields
 * DELETE /api/discounts/[id] — delete a discount
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { requireOwner } from '../../../../lib/server/auth';
import { audit } from '../../../../lib/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getSession(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  if (!tg?.id) return null;
  const business = await findBusinessForUser(tg.id);
  if (!business) return null;
  return { business, tg };
}

export async function PATCH(request, { params }) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { business, tg } = session;
  if (!requireOwner(business, tg)) {
    return NextResponse.json({ error: 'forbidden', detail: 'Only the shop owner can modify discounts.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const updates = {};
  if (body.is_active !== undefined) updates.is_active = !!body.is_active;
  if (body.expires_at !== undefined) updates.expires_at = body.expires_at;
  if (body.max_uses !== undefined) updates.max_uses = body.max_uses ? Number(body.max_uses) : null;
  if (body.value !== undefined) updates.value = Number(body.value);

  const { data } = await supabase()
    .from('discounts')
    .update(updates)
    .eq('id', params.id)
    .eq('business_id', business.id)
    .select()
    .single();

  await audit({
    business_id: business.id, actor_type: 'owner', actor_id: String(tg.id),
    action: 'discount.updated', resource_type: 'discount', resource_id: params.id,
    metadata: updates, request,
  });
  return NextResponse.json({ ok: true, discount: data });
}

export async function DELETE(request, { params }) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { business, tg } = session;
  if (!requireOwner(business, tg)) {
    return NextResponse.json({ error: 'forbidden', detail: 'Only the shop owner can delete discounts.' }, { status: 403 });
  }

  await supabase()
    .from('discounts')
    .delete()
    .eq('id', params.id)
    .eq('business_id', business.id);

  await audit({
    business_id: business.id, actor_type: 'owner', actor_id: String(tg.id),
    action: 'discount.deleted', resource_type: 'discount', resource_id: params.id,
    request,
  });
  return NextResponse.json({ ok: true });
}
