/**
 * POST   /api/products/:id/image  — upload a showcase image (multipart)
 * DELETE /api/products/:id/image  — remove the image
 *
 * Uses the existing 'documents' Supabase Storage bucket so we don't need a
 * new bucket. Files land at: products/<business_id>/<product_id>-<rand>.<ext>
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findByOwnerTelegramId } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function resolveOwner(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? findByOwnerTelegramId(tg.id) : null;
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
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'no file' }, { status: 400 });

  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().slice(0, 5);
  const path = `products/${business.id}/${product.id}-${Date.now()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());

  const { error: upErr } = await sb.storage.from('documents').upload(path, buf, {
    contentType: file.type || 'image/jpeg',
    upsert: true,
  });
  if (upErr) return NextResponse.json({ error: 'upload_failed', detail: upErr.message }, { status: 500 });

  const { data: pub } = sb.storage.from('documents').getPublicUrl(path);
  const image_url = pub?.publicUrl || null;
  if (!image_url) return NextResponse.json({ error: 'no_public_url' }, { status: 500 });

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
