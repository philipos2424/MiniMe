/**
 * POST /api/conversations/[id]/upload
 * Accepts a multipart file upload from the owner's Mini App reply bar.
 * Uses the service-role Supabase client so no anon-key/RLS issues arise.
 * Returns { url, type, name } for the caller to embed in a subsequent
 * /reply request.
 *
 * Limits: 20 MB, images + PDFs + audio + video only.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const ALLOWED_MIME = /^(image\/(jpeg|png|gif|webp|heic)|application\/pdf|audio\/(ogg|mpeg|mp4|webm|wav)|video\/(mp4|webm|ogg|quicktime))$/i;

export async function POST(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Verify the conversation belongs to this business
  const sb = supabase();
  const { data: conv } = await sb.from('conversations')
    .select('id, business_id')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();
  if (!conv) return NextResponse.json({ error: 'not found' }, { status: 404 });

  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'invalid multipart body' }, { status: 400 });
  }

  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'file field required' }, { status: 400 });
  }

  const mime = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.test(mime)) {
    return NextResponse.json({ error: `Unsupported file type: ${mime}` }, { status: 415 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (20 MB max)' }, { status: 413 });
  }

  const ext = (file.name?.split('.').pop() || mime.split('/')[1] || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const storagePath = `media/${business.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: upErr } = await sb.storage.from('documents').upload(storagePath, buf, {
    contentType: mime,
    upsert: false,
  });
  if (upErr) {
    console.error('media upload failed:', upErr.message);
    return NextResponse.json({ error: `Upload failed: ${upErr.message}` }, { status: 500 });
  }

  const { data: pub } = sb.storage.from('documents').getPublicUrl(storagePath);
  if (!pub?.publicUrl) {
    return NextResponse.json({ error: 'Could not get public URL' }, { status: 500 });
  }

  return NextResponse.json({
    url: pub.publicUrl,
    type: mime,
    name: file.name || storagePath.split('/').pop(),
  });
}
