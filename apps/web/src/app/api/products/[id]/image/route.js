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
const BUCKET = 'product-images';
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { imageFile, ValidationError, validationResponse } from '../../../../../lib/server/sanitize';

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

  // Validate file type, extension, and size before touching the buffer
  let fileValidation;
  try {
    fileValidation = imageFile(file, { field: 'file', maxBytes: 5 * 1024 * 1024 });
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: 'file too large (max 5 MB)' }, { status: 413 });
  }

  // Validate magic bytes for common image formats
  const magic = buf.slice(0, 4);
  const isValidMagic = (
    (magic[0] === 0xFF && magic[1] === 0xD8) || // JPEG
    (magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4E && magic[3] === 0x47) || // PNG
    (magic[0] === 0x52 && magic[1] === 0x49 && magic[2] === 0x46 && magic[3] === 0x46) || // WebP (RIFF)
    (magic[0] === 0x47 && magic[1] === 0x49 && magic[2] === 0x46) // GIF
  );
  if (!isValidMagic) {
    return NextResponse.json({ error: 'file content does not match a supported image format' }, { status: 415 });
  }

  const ext = fileValidation.ext;
  const path = `products/${business.id}/${product.id}-${Date.now()}.${ext}`;

  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type || 'image/jpeg',
    upsert: true,
  });
  if (upErr) return NextResponse.json({ error: 'upload_failed', detail: upErr.message }, { status: 500 });

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
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
