/**
 * POST /api/settings/upload-logo
 *
 * Accepts a multipart form upload, saves to Supabase Storage,
 * and updates businesses.logo_url with the public URL.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { uploadShopLogo } from '../../../../lib/server/shopLogo.mjs';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data') || '';
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get('logo');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'no_file' }, { status: 400 });
  }

  // Validate type + size
  const mime = file.type || '';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
    return NextResponse.json({ error: 'invalid_type — use JPEG, PNG or WebP' }, { status: 400 });
  }
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'file_too_large — max 5 MB' }, { status: 400 });
  }

  const ext  = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';

  // Same storage and path as /api/settings/logo (public bucket; the private
  // `documents` bucket's URLs 404), so both upload buttons show the same photo.
  const sb = supabase();
  let logo_url;
  try {
    logo_url = await uploadShopLogo(sb, business.id, Buffer.from(bytes), mime, ext);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  await sb.from('businesses').update({ logo_url }).eq('id', business.id);

  return NextResponse.json({ ok: true, logo_url });
}
