/**
 * POST /api/settings/logo
 * Owner uploads a shop logo/cover photo. This is the image shown on MiniMe
 * Search and Market listings (falls back to a random product photo when
 * unset — see directory/search/route.js). No Vision extraction here, unlike
 * /api/teach/image — a logo isn't catalog knowledge, just a display asset.
 *
 * Supports: JPG, PNG, WebP (max 8 MB)
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser, update as updateBusiness } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024;
const EXT_BY_MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function POST(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let formData;
  try { formData = await request.formData(); }
  catch { return NextResponse.json({ error: 'invalid form data' }, { status: 400 }); }

  const file = formData.get('file');
  if (!file) return NextResponse.json({ error: 'no file provided' }, { status: 400 });

  const mimeType = file.type || '';
  const ext = EXT_BY_MIME[mimeType];
  if (!ext) return NextResponse.json({ error: 'Only JPG, PNG, or WebP images are supported' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Image too large (max 8 MB)' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const sb = supabase();
  // upsert:true + a fixed filename per business so re-uploads replace the old
  // logo in place rather than accumulating orphaned files in storage.
  const storagePath = `logos/${business.id}/logo.${ext}`;
  const { error: upErr } = await sb.storage.from('documents').upload(storagePath, buf, {
    contentType: mimeType, upsert: true,
  });
  if (upErr) {
    console.error('[settings/logo] upload failed:', upErr.message);
    return NextResponse.json({ error: 'Upload failed — please try again' }, { status: 500 });
  }
  const { data: pub } = sb.storage.from('documents').getPublicUrl(storagePath);
  // Cache-bust: same path every time, so append a version query param or the
  // owner's browser (and search cards) may keep showing the old cached image.
  const logo_url = `${pub.publicUrl}?v=${Date.now()}`;

  const updated = await updateBusiness(business.id, { logo_url });
  if (!updated) return NextResponse.json({ error: 'save failed' }, { status: 500 });

  return NextResponse.json({ ok: true, logo_url });
}
