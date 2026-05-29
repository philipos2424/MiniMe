/**
 * POST /api/conversations/[id]/reply
 * Sends an owner reply to a customer via the business's Telegram bot.
 * Also saves the message to the DB so it appears in the conversation view.
 *
 * Body: { text?: string, file?: { url, type, name } }
 * - With text only → sendMessage
 * - With file → sendPhoto / sendVoice / sendAudio / sendDocument (caption = text)
 */
import { NextResponse } from 'next/server';
import { verifyTelegramInitData, parseTelegramUser } from '../../../../../lib/telegram';
import { findBusinessForUser } from '../../../../../lib/server/businesses';
import { supabase } from '../../../../../lib/server/db';
import { decrypt } from '../../../../../lib/server/crypto';
import { tg } from '../../../../../lib/server/telegramApi';
import { str, telegramFileUrl, ValidationError, validationResponse } from '../../../../../lib/server/sanitize';

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

  const body = await request.json().catch(() => ({}));

  // ── Input validation & sanitization ──────────────────────────────────────
  let text = '';
  let file = null;
  try {
    if (body.text !== undefined) {
      text = str(body.text, { field: 'text', min: 0, max: 4096, stripHtml: false });
    }
    if (body.file?.url) {
      // SSRF prevention: file.url must be a valid Telegram CDN URL
      const safeUrl = telegramFileUrl(body.file.url, { field: 'file.url' });
      const safeName = str(body.file.name || '', { field: 'file.name', max: 255, required: false });
      const safeType = str(body.file.type || '', { field: 'file.type', max: 100, required: false });
      file = { url: safeUrl, name: safeName, type: safeType };
    }
  } catch (e) {
    return e instanceof ValidationError ? validationResponse(e) : NextResponse.json({ error: e.message }, { status: 400 });
  }

  if (!text && !file) {
    return NextResponse.json({ error: 'text or file required' }, { status: 400 });
  }

  const sb = supabase();

  // Verify conversation belongs to this business, get customer's telegram_id
  const { data: conversation } = await sb.from('conversations')
    .select('id, business_id, customer_id, platform, message_count, customers(telegram_id, name, telegram_username)')
    .eq('id', params.id)
    .eq('business_id', business.id)
    .maybeSingle();

  if (!conversation) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const customerTgId = conversation.customers?.telegram_id;
  const platform = conversation.platform || 'telegram';
  // Only require Telegram ID for Telegram conversations
  if (!customerTgId && platform === 'telegram') {
    return NextResponse.json({ error: 'customer has no Telegram account' }, { status: 422 });
  }

  // Resolve bot token for this business
  let token = process.env.TELEGRAM_BOT_TOKEN;
  if (business.telegram_bot_token_enc) {
    try { token = decrypt(business.telegram_bot_token_enc); } catch {}
  }
  // ── Non-Telegram platforms (WhatsApp / Instagram / Facebook) ──────────────
  if (platform !== 'telegram') {
    if (!text) return NextResponse.json({ error: 'text required for non-Telegram platforms' }, { status: 400 });
    try {
      const { sendMetaReply } = await import('../../../../../lib/server/metaReplyEngine');
      await sendMetaReply({ business, conversation, text });
    } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    const { data: saved } = await sb.from('messages').insert({
      conversation_id: conversation.id, business_id: business.id, customer_id: conversation.customer_id,
      direction: 'outbound', content: text, content_type: 'text', status: 'sent',
      is_ai_generated: false, platform, sent_at: new Date().toISOString(),
    }).select().single();
    await sb.from('conversations').update({
      last_message_at: new Date().toISOString(), requires_owner: false,
      last_ai_action: 'owner_replied_mini_app', message_count: (conversation.message_count || 0) + 1,
    }).eq('id', conversation.id);
    return NextResponse.json({ ok: true, message: saved });
  }

  if (!token) return NextResponse.json({ error: 'bot token not configured' }, { status: 500 });

  // Send via Telegram — branch on whether there's a file
  let sentMessageId = null;
  let contentType = 'text';
  try {
    if (file) {
      const mime = file.type || '';
      let method = 'sendDocument';
      let payload = { chat_id: customerTgId, document: file.url };
      if (mime.startsWith('image/'))      { method = 'sendPhoto';    payload = { chat_id: customerTgId, photo: file.url }; contentType = 'photo'; }
      else if (mime === 'audio/ogg' || mime.includes('opus')) { method = 'sendVoice'; payload = { chat_id: customerTgId, voice: file.url }; contentType = 'voice'; }
      else if (mime.startsWith('audio/')) { method = 'sendAudio';    payload = { chat_id: customerTgId, audio: file.url }; contentType = 'audio'; }
      else if (mime.startsWith('video/')) { method = 'sendVideo';    payload = { chat_id: customerTgId, video: file.url }; contentType = 'video'; }
      else                                { contentType = 'document'; }
      if (text) payload.caption = text;
      const res = await tg(token, method, payload);
      sentMessageId = res?.result?.message_id || null;
    } else {
      const res = await tg(token, 'sendMessage', {
        chat_id: customerTgId,
        text,
        // No parse_mode — owner's text is plain and may contain Markdown-special chars
      });
      sentMessageId = res?.result?.message_id || null;
    }
  } catch (e) {
    console.error('owner reply send failed:', e.message);
    return NextResponse.json({ error: 'Failed to send message: ' + e.message }, { status: 502 });
  }

  // Save to DB
  const insertRow = {
    conversation_id: conversation.id,
    business_id: business.id,
    customer_id: conversation.customer_id,
    direction: 'outbound',
    content: text || (file ? `[${contentType}]` : ''),
    content_type: contentType,
    status: 'sent',
    is_ai_generated: false,
    telegram_message_id: sentMessageId,
    telegram_chat_id: customerTgId,
  };
  if (file) {
    insertRow.file_url = file.url;
    insertRow.media_url = file.url;
    insertRow.file_type = file.type || null;
    insertRow.media_type = file.type || null;
    insertRow.file_name = file.name || null;
    insertRow.media_filename = file.name || null;
  }
  const { data: saved } = await sb.from('messages').insert(insertRow).select().single();

  // Update conversation last_message_at + clear requires_owner + bump count
  const { data: curr } = await sb.from('conversations').select('message_count').eq('id', conversation.id).maybeSingle();
  await sb.from('conversations').update({
    last_message_at: new Date().toISOString(),
    requires_owner: false,
    last_ai_action: 'owner_replied_mini_app',
    message_count: (curr?.message_count || 0) + 1,
  }).eq('id', conversation.id);

  return NextResponse.json({ ok: true, message: saved });
}
