/**
 * POST   /api/products/:id/image  — upload a showcase image (multipart)
 * DELETE /api/products/:id/image  — remove the image
 *
 * Stored in the PUBLIC 'product-images' bucket (NOT 'documents' — that bucket is
 * private and holds business knowledge files/customer media; its public URLs 403,
 * so product photos uploaded there never rendered). Product photos are shown to
 * customers and embedded by the bot, so they need a genuinely public URL.
 * Files land at: products/<business_id>/<product_id>-<rand>.<ext>
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { ValidationError, validationResponse } from '../../../../../lib/server/sanitize';
import { storeProductPhoto } from '../../../../../lib/server/productImages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function resolveOwner(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findBusinessForUser(tg.id) : null;
}

export async function POST(request, { params }) {
  const business = await resolveOwner(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();
  const { data: product } = await sb.from('products').select('id, business_id, image_url').eq('id', params.id).single();
  if (!product) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (product.business_id !== business.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const form = await request.formData();
  const file = form.get('file');

  let image_url;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    ({ image_url } = await storeProductPhoto(sb, business.id, file, buf, { label: product.id }));
  } catch (e) {
    if (e instanceof ValidationError) return validationResponse(e);
    return NextResponse.json({ error: e.message || 'upload_failed' }, { status: 500 });
  }

  await sb.from('products').update({ image_url }).eq('id', product.id);
  return NextResponse.json({ ok: true, image_url });
}

export async function DELETE(request, { params }) {
  const business = await resolveOwner(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sb = supabase();
  const { data: product } = await sb.from('products').select('id, business_id').eq('id', params.id).single();
  if (!product || product.business_id !== business.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  await sb.from('products').update({ image_url: null }).eq('id', product.id);
  return NextResponse.json({ ok: true });
}
