/**
 * POST /api/messages/[id]/skip
 * Marks an AI draft as skipped and clears requires_owner on the conversation.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request, { params }) {
  const initData = request.headers.get('x-telegram-init-data');
  if (!initData || !verifyTelegramInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const tgUser = parseTelegramUser(initData);
  const business = tgUser?.id ? await findBusinessForUser(tgUser.id) : null;
  if (!business) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const sb = supabase();

  const { data: msg } = await sb.from('messages')
    .select('id, conversation_id, business_id, status')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();

  if (!msg) return NextResponse.json({ error: 'message not found' }, { status: 404 });
  if (msg.status !== 'drafted' && msg.status !== 'pending_approval') {
    return NextResponse.json({ error: `message is already ${msg.status}` }, { status: 409 });
  }

  await sb.from('messages').update({ status: 'skipped' }).eq('id', params.id);
  await sb.from('conversations').update({
    requires_owner: false,
    last_ai_action: 'skipped',
  }).eq('id', msg.conversation_id);

  return NextResponse.json({ ok: true });
}