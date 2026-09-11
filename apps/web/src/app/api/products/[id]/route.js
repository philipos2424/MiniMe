/**
 * PATCH  /api/products/:id  — edit fields on one item
 * DELETE /api/products/:id  — remove one item
 *
 * Both were anon-key writes from ProductsPage that silently did nothing after
 * 047_lock_down_anon_access.sql. See productCrud.mjs.
 *
 * Ownership is enforced in the query itself (id AND business_id), not by a
 * read-then-write check, so there is no window between the two and a product id
 * belonging to another shop simply matches no row.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';
import { updateProduct, deleteProduct } from '../../../../lib/server/productCrud.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveOwner(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findBusinessForUser(tg.id) : null;
}

export async function PATCH(request, { params }) {
  const business = await resolveOwner(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    const { found, product } = await updateProduct(supabase(), {
      businessId: business.id,
      productId: params.id,
      fields: body,
    });
    if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ product });
  } catch (error) {
    if (/no editable fields|name/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[/api/products/:id] update failed:', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const business = await resolveOwner(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { found } = await deleteProduct(supabase(), {
      businessId: business.id,
      productId: params.id,
    });
    if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[/api/products/:id] delete failed:', error);
    return NextResponse.json({ error: 'write_failed' }, { status: 500 });
  }
}
