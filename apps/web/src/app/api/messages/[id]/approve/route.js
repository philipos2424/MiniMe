/**
 * POST /api/messages/[id]/approve
 * Approves an AI draft and sends it through the conversation's channel.
 *
 * Body: { edited_content?: string }
 *   - If edited_content is provided, sends that text instead of the original draft.
 *
 * Mirrors the Telegram callback `approve_*` handler in replyEngine.js.
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { decrypt } from '../../../../../lib/server/crypto';
import { tg } from '../../../../../lib/server/telegramApi';
import { requireOwner } from '../../../../../lib/server/auth';
import { learnFromOwnerEdit } from '../../../../../lib/server/replyEngine';

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
    return NextResponse.json({ error: 'forbidden', detail: 'Only the shop owner can approve drafts.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const editedContent = (body.edited_content || '').trim() || null;

  const sb = supabase();

  // Fetch the draft — verify it belongs to this business
  const { data: msg } = await sb.from('messages')
    .select('id, conversation_id, business_id, content, status, telegram_chat_id, telegram_message_id, customer_id, platform')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();

  if (!msg) return NextResponse.json({ error: 'message not found' }, { status: 404 });
  if (msg.status !== 'pending_approval' && msg.status !== 'drafted') {
    return NextResponse.json({ error: `message is already ${msg.status}` }, { status: 409 });
  }

  const textToSend = editedContent || msg.content;
  if (!textToSend) return NextResponse.json({ error: 'no content to send' }, { status: 400 });
  const originalDraft = msg.content || '';   // captured before the update overwrites content

  const { data: conversation } = await sb.from('conversations')
    .select('id, platform, message_count, external_thread_id')
    .eq('id', msg.conversation_id)
    .eq('business_id', business.id)
    .maybeSingle();
  if (!conversation) return NextResponse.json({ error: 'conversation not found' }, { status: 404 });

  const platform = conversation.platform || msg.platform || 'telegram';
  let token = process.env.TELEGRAM_BOT_TOKEN;
  if (business.telegram_bot_token_enc) {
    try { token = decrypt(business.telegram_bot_token_enc); } catch {}
  }

  // Send through the channel that created the draft. Telegram remains the
  // default for legacy rows; social channels use their own transport adapters.
  try {
    if (platform === 'telegram') {
      if (!token) return NextResponse.json({ error: 'bot token not configured' }, { status: 500 });
      if (!msg.telegram_chat_id) return NextResponse.json({ error: 'no telegram_chat_id on message' }, { status: 422 });
      await tg(token, 'sendMessage', {
        chat_id: msg.telegram_chat_id,
        text: textToSend,
        reply_to_message_id: msg.telegram_message_id || undefined,
      });
    } else if (platform === 'tiktok') {
      const { sendTikTokReply } = await import('../../../../../lib/server/tiktokReplyEngine');
      await sendTikTokReply({ business, conversation, text: textToSend });
    } else if (['whatsapp', 'instagram', 'facebook'].includes(platform)) {
      const { sendMetaReply } = await import('../../../../../lib/server/metaReplyEngine');
      await sendMetaReply({ business, conversation, text: textToSend });
    } else {
      return NextResponse.json({ error: `unsupported platform: ${platform}` }, { status: 422 });
    }
  } catch (e) {
    console.error(`draft send failed on ${platform}:`, e.message);
    return NextResponse.json({ error: `${platform} send failed: ${e.message}` }, { status: 502 });
  }

  // Mark as sent
  const now = new Date().toISOString();
  await sb.from('messages').update({
    status: 'sent',
    content: textToSend,                    // persist edit if any
    approved_at: now,
    sent_at: now,
    owner_edited: !!editedContent,
  }).eq('id', msg.id);

  // Update conversation
  const { data: curr } = await sb.from('conversations').select('message_count').eq('id', msg.conversation_id).maybeSingle();
  await sb.from('conversations').update({
    last_message_at: now,
    requires_owner: false,
    last_ai_action: 'approved',
    message_count: (curr?.message_count ?? conversation.message_count ?? 0) + 1,
  }).eq('id', msg.conversation_id);

  // If the owner edited the draft, teach the corrected answer + suppress the
  // rejected one (best-effort; never blocks the approve response).
  if (editedContent) {
    await learnFromOwnerEdit(business, {
      conversationId: msg.conversation_id,
      originalDraft,
      correctedText: editedContent,
      token,
    }).catch((e) => console.warn('[approve] learnFromOwnerEdit failed:', e.message));
  }

  return NextResponse.json({ ok: true });
}
