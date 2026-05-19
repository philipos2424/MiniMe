/**
 * B2B Messaging — lets MiniMe businesses' bots talk to each other.
 *
 * Telegram itself blocks bot-to-bot direct messaging, so we route through
 * the MiniMe backend: when Bot A "messages" Bot B, what actually happens is:
 *   1. We insert a row in `business_messages`
 *   2. We use Bot B's token to DM Bot B's OWNER with the message + inline
 *      keyboard (Reply / Decline / Let MiniMe answer)
 *   3. Owner B taps a button → callback flows back through replyEngine.js
 *      → we either insert a reply row or mark declined, and notify Bot A's
 *      owner via Bot A's token.
 *
 * From Telegram's POV: each bot only ever messaged its own owner. Legal.
 * From the owners' POV: their bots "talked." Magic.
 */
import { supabase } from './db';
import { tg } from './telegramApi';
import { decrypt } from './crypto';
import { rateLimit } from './rateLimit';

const MAX_OUTBOUND_PER_PAIR_PER_HOUR = 10;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.WEB_URL || 'https://web-theta-one-68.vercel.app';

/**
 * Normalize a Telegram bot username — strip @, lowercase, strip url prefix.
 */
function normalizeHandle(raw) {
  if (!raw) return '';
  let h = String(raw).trim();
  h = h.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '');
  h = h.replace(/^@/, '');
  h = h.replace(/\?.*$/, '');
  return h.toLowerCase();
}

/**
 * Look up a MiniMe business by its bot @username.
 * Returns the business row (with discoverable=true only), or null.
 */
export async function findBusinessByUsername(handle) {
  const h = normalizeHandle(handle);
  if (!h || h.length < 3) return null;
  const sb = supabase();
  const { data } = await sb
    .from('businesses')
    .select('*')
    .ilike('telegram_bot_username', h)
    .maybeSingle();
  if (!data) return null;
  if (data.b2b_discoverable === false) return null;
  return data;
}

/**
 * Owner-facing display label for a business: name + @username.
 */
export function bizLabel(biz) {
  if (!biz) return 'Unknown business';
  const name = biz.name || 'Business';
  const u = biz.telegram_bot_username ? ` (@${biz.telegram_bot_username})` : '';
  return `${name}${u}`;
}

/**
 * Send a B2B message from one business to another.
 *
 * @param {object} opts
 * @param {object} opts.senderBiz   — full businesses row of sender
 * @param {object} opts.recipientBiz — full businesses row of recipient
 * @param {number} opts.initiatedBy  — owner_telegram_id of initiating owner
 * @param {string} opts.intent       — 'inquiry'|'order'|'coordination'|'chat'|'reply'
 * @param {string} opts.content      — plain-English message
 * @param {object} [opts.structured] — optional payload (product, qty, etc.)
 * @param {string} [opts.parentId]   — parent message id (for replies/threads)
 * @returns {Promise<{ok:boolean, error?:string, message?:object, threadId?:string}>}
 */
export async function sendBusinessMessage({
  senderBiz, recipientBiz, initiatedBy,
  intent = 'inquiry', content, structured = {}, parentId = null,
}) {
  if (!senderBiz?.id || !recipientBiz?.id) return { ok: false, error: 'invalid_business' };
  if (senderBiz.id === recipientBiz.id) return { ok: false, error: 'cannot_message_self' };
  if (!content?.trim()) return { ok: false, error: 'empty_message' };

  // Blocklist check — has recipient blocked this sender's initiating owner?
  const blocklist = Array.isArray(recipientBiz.b2b_blocklist) ? recipientBiz.b2b_blocklist : [];
  if (blocklist.map(Number).includes(Number(initiatedBy))) {
    return { ok: false, error: 'blocked_by_recipient' };
  }

  // Rate limit: per sender→recipient pair, 10/hour
  const rlKey = `${senderBiz.id}->${recipientBiz.id}`;
  const { ok: rlOk } = rateLimit(rlKey, 'b2b-outbound', MAX_OUTBOUND_PER_PAIR_PER_HOUR, 3600);
  if (!rlOk) return { ok: false, error: 'rate_limited' };

  // Resolve thread: reuse if replying, else new
  let threadId = null;
  if (parentId) {
    const { data: parent } = await supabase()
      .from('business_messages')
      .select('thread_id')
      .eq('id', parentId)
      .maybeSingle();
    if (parent?.thread_id) threadId = parent.thread_id;
  }
  if (!threadId) {
    // Postgres will generate a uuid — but we need it inline. Use crypto.
    const { randomUUID } = await import('crypto');
    threadId = randomUUID();
  }

  // Insert
  const { data: row, error: insertErr } = await supabase()
    .from('business_messages')
    .insert({
      thread_id:    threadId,
      sender_id:    senderBiz.id,
      recipient_id: recipientBiz.id,
      initiated_by: initiatedBy,
      intent,
      content:      content.trim(),
      structured,
      parent_id:    parentId,
      status:       'pending',
    })
    .select()
    .single();

  if (insertErr || !row) {
    console.error('[b2b.sendBusinessMessage] insert error:', insertErr?.message);
    return { ok: false, error: 'db_error' };
  }

  // Deliver via recipient's bot to recipient's owner
  await deliverInboundToOwner(row, senderBiz, recipientBiz).catch(e => {
    console.warn('[b2b] delivery failed:', e.message);
  });

  return { ok: true, message: row, threadId };
}

/**
 * DM the recipient's owner about the incoming message, with action keyboard.
 */
async function deliverInboundToOwner(row, senderBiz, recipientBiz) {
  if (!recipientBiz.telegram_bot_token_enc) return;
  let token;
  try { token = decrypt(recipientBiz.telegram_bot_token_enc); } catch { return; }
  const ownerChat = recipientBiz.owner_private_chat_id || recipientBiz.owner_telegram_id;
  if (!ownerChat) return;

  // First-contact check — has this sender ever messaged us before?
  const { count: priorCount } = await supabase()
    .from('business_messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_id', senderBiz.id)
    .eq('recipient_id', recipientBiz.id);
  const firstContact = (priorCount || 0) <= 1; // <=1 because this row is already inserted

  const intentEmoji = {
    inquiry: '❓', order: '🛒', coordination: '🤝', chat: '💬', reply: '↩️',
  }[row.intent] || '📨';

  const isReply = row.intent === 'reply' || row.parent_id;
  const header = isReply
    ? `✉️ *Reply from ${escapeMd(senderBiz.name)}*${senderBiz.telegram_bot_username ? ` (@${senderBiz.telegram_bot_username})` : ''}`
    : `${intentEmoji} *${escapeMd(senderBiz.name)} is reaching out*${senderBiz.telegram_bot_username ? ` (@${senderBiz.telegram_bot_username})` : ''}`;

  const structuredLines = [];
  if (row.structured?.product) structuredLines.push(`📦 ${row.structured.product}`);
  if (row.structured?.qty) structuredLines.push(`📊 Qty: ${row.structured.qty}${row.structured.unit ? ' ' + row.structured.unit : ''}`);
  if (row.structured?.urgency) structuredLines.push(`⏱ ${row.structured.urgency}`);
  if (row.structured?.deadline) structuredLines.push(`📅 By ${row.structured.deadline}`);

  const text = [
    header,
    '',
    `"${truncate(row.content, 500)}"`,
    structuredLines.length ? '\n' + structuredLines.join('\n') : '',
    firstContact && !isReply ? '\n_First time this business has contacted you._' : '',
  ].filter(Boolean).join('\n');

  // Inline keyboard: Reply / Decline / Let MiniMe answer
  // (For replies-back we use a different keyboard: Continue / Open in dashboard)
  const reply_markup = isReply ? {
    inline_keyboard: [[
      { text: '✍️ Continue thread', callback_data: `b2b:continue:${row.thread_id}` },
      { text: '📊 Open dashboard', web_app: { url: `${APP_URL}/b2b?thread=${row.thread_id}` } },
    ]],
  } : {
    inline_keyboard: [
      [
        { text: '✍️ Reply',  callback_data: `b2b:reply:${row.id}` },
        { text: '🤖 Let MiniMe answer', callback_data: `b2b:ai:${row.id}` },
      ],
      [
        { text: '✕ Decline', callback_data: `b2b:decline:${row.id}` },
        ...(firstContact ? [{ text: '🚫 Block sender', callback_data: `b2b:block:${row.id}` }] : []),
      ],
    ],
  };

  await tg(token, 'sendMessage', {
    chat_id: ownerChat, text, parse_mode: 'Markdown', reply_markup,
  });

  await supabase()
    .from('business_messages')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .eq('id', row.id);
}

/**
 * Record a reply to a B2B message. Sends the reply back to the original sender's owner.
 *
 * @param {object} opts
 * @param {string} opts.originalMsgId — the id we are replying to
 * @param {string} opts.content        — the reply text
 * @param {boolean} [opts.byAi]        — true if AI-drafted
 * @param {number} opts.replierTgId    — replier's owner_telegram_id
 */
export async function recordReply({ originalMsgId, content, byAi = false, replierTgId }) {
  if (!originalMsgId || !content?.trim()) return { ok: false, error: 'invalid_args' };
  const sb = supabase();

  const { data: orig } = await sb
    .from('business_messages')
    .select('*')
    .eq('id', originalMsgId)
    .maybeSingle();
  if (!orig) return { ok: false, error: 'original_not_found' };

  // Fetch both businesses
  const { data: senderBiz } = await sb
    .from('businesses').select('*').eq('id', orig.recipient_id).maybeSingle();
  const { data: recipientBiz } = await sb
    .from('businesses').select('*').eq('id', orig.sender_id).maybeSingle();
  if (!senderBiz || !recipientBiz) return { ok: false, error: 'business_not_found' };

  // Mark original as replied
  await sb.from('business_messages')
    .update({ status: 'replied', replied_at: new Date().toISOString() })
    .eq('id', originalMsgId);

  // Insert reply row (swaps sender/recipient)
  const { data: replyRow, error: insertErr } = await sb
    .from('business_messages')
    .insert({
      thread_id:    orig.thread_id,
      sender_id:    senderBiz.id,
      recipient_id: recipientBiz.id,
      initiated_by: replierTgId || senderBiz.owner_telegram_id,
      intent:       'reply',
      content:      content.trim(),
      parent_id:    originalMsgId,
      ai_drafted:   !!byAi,
      status:       'pending',
    })
    .select()
    .single();
  if (insertErr || !replyRow) return { ok: false, error: 'db_error' };

  await deliverInboundToOwner(replyRow, senderBiz, recipientBiz);
  return { ok: true, reply: replyRow };
}

/**
 * Mark a B2B message as declined. Notifies sender lightly.
 */
export async function recordDecline(msgId, reason) {
  const sb = supabase();
  const { data: orig } = await sb
    .from('business_messages')
    .select('*')
    .eq('id', msgId)
    .maybeSingle();
  if (!orig) return { ok: false, error: 'not_found' };
  await sb.from('business_messages')
    .update({ status: 'declined', replied_at: new Date().toISOString() })
    .eq('id', msgId);

  // Notify sender (soft notification, no inline keyboard)
  const { data: senderBiz } = await sb
    .from('businesses').select('*').eq('id', orig.sender_id).maybeSingle();
  const { data: recipientBiz } = await sb
    .from('businesses').select('*').eq('id', orig.recipient_id).maybeSingle();
  if (senderBiz?.telegram_bot_token_enc) {
    let token;
    try { token = decrypt(senderBiz.telegram_bot_token_enc); } catch {}
    const chat = senderBiz.owner_private_chat_id || senderBiz.owner_telegram_id;
    if (token && chat) {
      await tg(token, 'sendMessage', {
        chat_id: chat, parse_mode: 'Markdown',
        text: `🔕 *${escapeMd(recipientBiz?.name || 'That business')}* declined your message.${reason ? `\n\n_${escapeMd(reason)}_` : ''}`,
      });
    }
  }
  return { ok: true };
}

/**
 * Block a sender. Adds their owner_telegram_id to recipient's b2b_blocklist.
 */
export async function blockSender(recipientBizId, senderInitiatedBy) {
  if (!recipientBizId || !senderInitiatedBy) return { ok: false };
  const sb = supabase();
  const { data: biz } = await sb
    .from('businesses').select('b2b_blocklist').eq('id', recipientBizId).maybeSingle();
  const list = Array.isArray(biz?.b2b_blocklist) ? biz.b2b_blocklist : [];
  if (!list.map(Number).includes(Number(senderInitiatedBy))) list.push(Number(senderInitiatedBy));
  await sb.from('businesses').update({ b2b_blocklist: list }).eq('id', recipientBizId);
  return { ok: true };
}

/**
 * List inbox for a business — most recent threads where they're the recipient.
 */
export async function listInbox(businessId, { status, limit = 50, offset = 0 } = {}) {
  const sb = supabase();
  let q = sb.from('business_messages')
    .select('*, sender:businesses!sender_id(id, name, telegram_bot_username)')
    .eq('recipient_id', businessId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

/**
 * List sent threads — most recent where they're the sender.
 */
export async function listOutbox(businessId, { limit = 50, offset = 0 } = {}) {
  const sb = supabase();
  const { data } = await sb.from('business_messages')
    .select('*, recipient:businesses!recipient_id(id, name, telegram_bot_username)')
    .eq('sender_id', businessId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  return data || [];
}

/**
 * Fetch a full thread by thread_id, ordered chronologically.
 */
export async function getThread(threadId, viewerBizId) {
  const sb = supabase();
  const { data } = await sb.from('business_messages')
    .select('*, sender:businesses!sender_id(id, name, telegram_bot_username), recipient:businesses!recipient_id(id, name, telegram_bot_username)')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (!data) return [];
  // Only return if viewer is sender or recipient on at least one row
  const involved = data.some(r => r.sender_id === viewerBizId || r.recipient_id === viewerBizId);
  return involved ? data : [];
}

/**
 * Quick count of unread (status='delivered') inbox items — for sidebar badge.
 */
export async function unreadCount(businessId) {
  const sb = supabase();
  const { count } = await sb.from('business_messages')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', businessId)
    .eq('status', 'delivered');
  return count || 0;
}

/* ──────────── helpers ──────────── */

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeMd(s) {
  if (!s) return '';
  return String(s).replace(/([_*\[\]()~`>#+=|{}.!\\-])/g, '\\$1');
}
