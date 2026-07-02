/**
 * GET  /api/scheduled-messages — list this business's failed scheduled messages.
 * POST /api/scheduled-messages — retry a failed scheduled message (resets it to 'pending').
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../lib/telegram';
import { findBusinessForUser } from '../../../lib/server/businesses';
import { supabase } from '../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function auth(request) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const tg = parseTelegramUser(initData);
  return tg?.id ? await findBusinessForUser(tg.id) : null;
}

export async function GET(request) {
  const business = await auth(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data } = await supabase()
    .from('scheduled_messages')
    .select('id, message, label, target_type, target_value, send_at, status, sent_count, failed_count, error_message, retry_count')
    .eq('business_id', business.id)
    .eq('status', 'failed')
    .order('send_at', { ascending: false })
    .limit(50);

  return NextResponse.json({ messages: data || [] });
}

export async function POST(request) {
  const business = await auth(request);
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 });

  const sb = supabase();
  const { data: msg } = await sb.from('scheduled_messages')
    .select('id, business_id, status')
    .eq('id', id).eq('business_id', business.id).maybeSingle();
  if (!msg) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (msg.status !== 'failed') return NextResponse.json({ error: 'not_failed' }, { status: 400 });

  await sb.from('scheduled_messages').update({
    status: 'pending',
    retry_count: 0,
    next_retry_at: null,
    owner_notified_failed: false,
    send_at: new Date().toISOString(),
    error_message: null,
  }).eq('id', id);

  return NextResponse.json({ ok: true });
}
