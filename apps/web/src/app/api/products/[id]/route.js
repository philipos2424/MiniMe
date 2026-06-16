/**
 * PATCH /api/products/[id] — update one product.
 * Body: { updates: { [field]: value, ... } }
 *
 * SECURITY: service role + Telegram initData. The update is scoped with
 * .eq('business_id', business.id) so an owner can only ever touch their own
 * products even if they pass another business's product id. Writable columns
 * are whitelisted (image_url is handled by /api/products/[id]/image).
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = new Set([
  'name', 'name_am', 'description', 'description_am', 'category',
  'price', 'cost_price', 'currency', 'stock_quantity', 'low_stock_threshold',
  'bulk_discount_threshold', 'bulk_discount_percent', 'max_negotiable_discount',
  'is_active',
]);

export async function PATCH(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const raw = body?.updates;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return NextResponse.json({ error: 'updates_required' }, { status: 400 });
  }

  const updates = {};
  for (const [k, v] of Object.entries(raw)) {
    if (ALLOWED_FIELDS.has(k)) updates[k] = v;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 });
  }

  const sb = supabase();
  const { data, error } = await sb.from('products')
    .update(updates)
    .eq('id', params.id)
    .eq('business_id', business.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ product: data });
}
