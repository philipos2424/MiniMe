/**
 * POST /api/conversations/[id]/answer-gap
 *
 * In-app counterpart to answering a "knowledge gap" via Telegram DM reply.
 * MiniMe held a customer instead of guessing (see askOwnerForKnowledgeGap in
 * replyEngine.js) and is waiting on the owner's answer. This lets the owner
 * answer from the Conversations page instead of switching to Telegram.
 *
 * Body: { answer: string }
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { decrypt } from '../../../../../lib/server/crypto';
import { requireOwner } from '../../../../../lib/server/auth';
import { resolveKnowledgeGapById } from '../../../../../lib/server/replyEngine';

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
  if (!requireOwner(business, tgUser)) {
    return NextResponse.json({ error: 'forbidden', detail: 'Only the shop owner can answer.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const answer = (body.answer || '').trim();
  if (!answer) return NextResponse.json({ error: 'answer is required' }, { status: 400 });

  const sb = supabase();

  // Find the most recent open gap for this conversation — verifies it
  // belongs to this business at the same time.
  const { data: gap } = await sb.from('knowledge_gaps')
    .select('id, conversation_id')
    .eq('conversation_id', params.id)
    .eq('business_id', business.id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!gap) return NextResponse.json({ error: 'no open question found for this conversation' }, { status: 404 });

  let token = process.env.TELEGRAM_BOT_TOKEN;
  if (business.telegram_bot_token_enc) {
    try { token = decrypt(business.telegram_bot_token_enc); } catch {}
  }

  const resolved = await resolveKnowledgeGapById(business, gap.id, answer, token);
  if (!resolved) return NextResponse.json({ error: 'could not resolve — it may have already been answered' }, { status: 409 });

  return NextResponse.json({ ok: true });
}
