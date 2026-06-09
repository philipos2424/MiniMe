/**
 * GET /api/conversations/[id] — conversation + messages for the dashboard.
 *
 * The browser anon key hits RLS and can't read `messages`, so the dashboard
 * goes through this server-side route which uses the service role and checks
 * that the caller owns the business.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../lib/telegram';
import { findBusinessForUser } from '../../../../lib/server/businesses';
import { supabase } from '../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'no business' }, { status: 404 });

  const sb = supabase();
  const { data: conversation } = await sb.from('conversations')
    .select('*, customers(*)')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();

  if (!conversation) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const before  = searchParams.get('before');  // ISO timestamp — load messages before this
  const after   = searchParams.get('after');   // ISO timestamp — load only new messages after this
  const PAGE    = 80;

  let q = sb.from('messages')
    .select('*')
    .eq('conversation_id', params.id)
    .eq('business_id', business.id)
    .order('created_at', { ascending: !!after }) // ascending for after (new), descending for before (older)
    .limit(PAGE);

  if (before) q = q.lt('created_at', before);
  if (after)  q = q.gt('created_at', after);

  const { data: msgs } = await q;
  // When fetching older (before), results come desc — reverse to chronological
  const messages = (msgs || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return NextResponse.json({
    conversation,
    messages,
    has_more: !after && messages.length === PAGE,
  });
}

export async function PATCH(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tg = parseTelegramUser(initData);
  const business = tg?.id ? await findBusinessForUser(tg.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const sb = supabase();

  const allowed = {};
  if (body.status && ['active', 'resolved', 'archived'].includes(body.status)) {
    allowed.status = body.status;
    if (body.status === 'resolved') allowed.requires_owner = false;
  }
  if (body.requires_owner !== undefined) allowed.requires_owner = !!body.requires_owner;

  if (!Object.keys(allowed).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  const { data: updated } = await sb.from('conversations')
    .update(allowed)
    .eq('id', params.id)
    .eq('business_id', business.id)
    .select()
    .single();

  return NextResponse.json({ ok: true, conversation: updated });
}
