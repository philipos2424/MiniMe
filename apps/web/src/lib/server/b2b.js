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

  // Fire auto-negotiation if recipient has it enabled (non-blocking)
  maybeAutoNegotiate({ ...row, status: 'delivered' }, senderBiz, recipientBiz).catch(() => {});
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

  // Research-campaign hook: if the original inquiry is part of a campaign,
  // notify the research engine so it can update progress and (maybe) synthesize.
  if (orig.campaign_id) {
    try {
      const research = await import('./research');
      research.processReplyForCampaign({ replyRow, originalRow: orig, campaignId: orig.campaign_id })
        .catch(e => console.warn('[research hook]', e.message));
    } catch (e) { console.warn('[research import]', e.message); }
  }

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

// ══════════════════════════════════════════════════════════════════════════════
//  AI NEGOTIATION ENGINE
// ══════════════════════════════════════════════════════════════════════════════

const MAX_AUTO_ROUNDS = 12; // prevent infinite loop between two auto-negotiating bots

/**
 * After a B2B message is delivered to a recipient, call this to check if
 * the recipient business has auto-negotiate enabled. If yes, run the AI
 * negotiator and send a response automatically.
 *
 * Called from deliverInboundToOwner after the DM is sent (fire-and-forget).
 */
export async function maybeAutoNegotiate(incomingRow, senderBiz, recipientBiz) {
  // Only run if recipient has auto-negotiate ON
  if (!recipientBiz.b2b_auto_negotiate) return;
  // Safety: cap rounds per thread
  if ((incomingRow.negotiation_round || 0) >= MAX_AUTO_ROUNDS) {
    console.warn('[b2b auto-negotiate] max rounds reached for thread', incomingRow.thread_id);
    return;
  }
  // Avoid replying to our own messages
  if (incomingRow.sender_id === recipientBiz.id) return;

  try {
    const response = await runNegotiationResponse(incomingRow, senderBiz, recipientBiz);
    if (!response) return;

    const nextRound = (incomingRow.negotiation_round || 0) + 1;

    if (response.action === 'accept') {
      // Deal agreed — record it
      await recordDeal({
        threadId:   incomingRow.thread_id,
        buyerBiz:   senderBiz,
        sellerBiz:  recipientBiz,
        offerData:  response.offer || incomingRow.offer_data || {},
        agreedBy:   'ai',
        summary:    response.message,
      });
    } else if (response.action === 'counter' || response.action === 'inquiry') {
      // Send the AI's counter-offer or question back
      await sendBusinessMessageInternal({
        senderBiz:   recipientBiz,
        recipientBiz: senderBiz,
        initiatedBy:  recipientBiz.owner_telegram_id,
        intent:       response.action === 'counter' ? 'coordination' : 'inquiry',
        content:      response.message,
        structured:   { ...(response.offer || {}), type: response.action },
        parentId:     incomingRow.id,
        negotiationRound: nextRound,
        offerData:    response.offer || {},
        threadStatus: 'negotiating',
        aiGenerated:  true,
      });
    } else if (response.action === 'decline') {
      await recordDecline(incomingRow.id, response.message);
    }
    // Notify owner of what the AI did (brief summary)
    if (recipientBiz.telegram_bot_token_enc) {
      let token;
      try { token = decrypt(recipientBiz.telegram_bot_token_enc); } catch {}
      const chat = recipientBiz.owner_private_chat_id || recipientBiz.owner_telegram_id;
      if (token && chat) {
        const actionLabel = { accept: '✅ Accepted deal', counter: '↩️ Counter-offered', inquiry: '❓ Asked', decline: '✕ Declined' }[response.action] || '↩️ Responded';
        await tg(token, 'sendMessage', {
          chat_id: chat, parse_mode: 'Markdown',
          text: `🤖 *MiniMe negotiated for you*\n\n${actionLabel} with *${escapeMd(senderBiz.name)}*:\n\n_"${truncate(response.message, 200)}"_\n\n[View thread →](${APP_URL}/b2b)`,
          disable_web_page_preview: true,
        });
      }
    }
  } catch (e) {
    console.error('[b2b auto-negotiate] error:', e.message);
  }
}

/**
 * Core AI negotiator. Reads the thread, understands the offer, and decides
 * what to do next based on the business's catalog and owner limits.
 *
 * Returns { action: 'accept'|'counter'|'inquiry'|'decline', message, offer? }
 */
async function runNegotiationResponse(incomingRow, senderBiz, recipientBiz) {
  const sb = supabase();
  const OpenAI = (await import('openai')).default;
  const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Load thread history (last 20 messages)
  const { data: history } = await sb
    .from('business_messages')
    .select('intent, content, offer_data, sender_id, ai_drafted, created_at, thread_status')
    .eq('thread_id', incomingRow.thread_id)
    .order('created_at', { ascending: true })
    .limit(20);

  // Load recipient's catalog
  const { data: products } = await sb
    .from('products')
    .select('name, price, currency, stock_quantity, description')
    .eq('business_id', recipientBiz.id)
    .eq('active', true)
    .limit(30);

  // Load owner's negotiation limits (stored in notification_prefs.b2b_limits)
  const limits = recipientBiz.notification_prefs?.b2b_limits || {};

  // Build thread history for the prompt
  const historyText = (history || []).map(m => {
    const side = m.sender_id === recipientBiz.id ? 'YOU' : `${senderBiz.name}`;
    const offerStr = m.offer_data && Object.keys(m.offer_data).length
      ? ` [offer: ${JSON.stringify(m.offer_data)}]`
      : '';
    return `${side}: ${m.content}${offerStr}`;
  }).join('\n');

  // Build catalog text
  const catalogText = (products || []).map(p =>
    `• ${p.name}: ${p.price} ${p.currency || 'ETB'}${p.stock_quantity != null ? ` (stock: ${p.stock_quantity})` : ''}`
  ).join('\n') || 'No products in catalog';

  // Build limits text
  const limitsText = Object.keys(limits).length
    ? Object.entries(limits).map(([k,v]) => `• ${k}: ${v}`).join('\n')
    : 'No explicit limits set — use your best judgment to get a fair deal.';

  const systemPrompt = `You are a professional B2B negotiation agent for "${recipientBiz.name || 'this business'}".

YOUR CATALOG & PRICES:
${catalogText}

OWNER NEGOTIATION LIMITS:
${limitsText}

NEGOTIATION THREAD SO FAR:
${historyText}

LATEST INCOMING MESSAGE:
${incomingRow.content}
${incomingRow.offer_data && Object.keys(incomingRow.offer_data).length ? `Structured offer: ${JSON.stringify(incomingRow.offer_data)}` : ''}

INSTRUCTIONS:
Decide the best next move to reach a good deal for your business. Be professional, direct, and specific. Reference actual prices from your catalog. Don't be a pushover, but don't be unreasonable.

Respond ONLY with a JSON object (no markdown):
{
  "action": "counter" | "accept" | "inquiry" | "decline",
  "message": "Your natural-language reply (1-4 sentences, conversational tone)",
  "offer": {
    "product": "...",
    "qty": 0,
    "unit": "...",
    "price_per_unit": 0,
    "total": 0,
    "currency": "ETB",
    "delivery": "...",
    "payment_terms": "..."
  }
}
- "accept": only if their terms are fully agreeable
- "counter": your counter-offer with updated numbers
- "inquiry": ask a clarifying question before making an offer
- "decline": only if terms are completely unacceptable or outside your catalog
- The "offer" field is optional for "inquiry" and "decline"`;

  try {
    const r = await oa.chat.completions.create({
      model: 'gpt-4.1',
      temperature: 0.3,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: systemPrompt }],
    });
    const raw = r.choices?.[0]?.message?.content?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!['accept','counter','inquiry','decline'].includes(parsed.action)) return null;
    return parsed;
  } catch (e) {
    console.warn('[b2b negotiation AI] error:', e.message);
    return null;
  }
}

/**
 * Record a finalized deal when both sides agree.
 */
export async function recordDeal({ threadId, buyerBiz, sellerBiz, offerData, agreedBy = 'ai', summary }) {
  const sb = supabase();

  // Mark the thread's last row as agreed
  await sb.from('business_messages')
    .update({ thread_status: 'agreed' })
    .eq('thread_id', threadId);

  // Insert a special deal-record row for easy retrieval
  const { randomUUID } = await import('crypto');
  const { data: dealRow } = await sb.from('business_messages').insert({
    thread_id:        threadId,
    sender_id:        sellerBiz.id,
    recipient_id:     buyerBiz.id,
    initiated_by:     sellerBiz.owner_telegram_id,
    intent:           'coordination',
    content:          summary || 'Deal agreed.',
    structured:       { type: 'deal', agreed_by: agreedBy },
    offer_data:       offerData || {},
    status:           'replied',
    thread_status:    'agreed',
    ai_drafted:       agreedBy === 'ai',
  }).select().single();

  const dealId = dealRow?.id || randomUUID();

  // Notify both owners
  for (const [biz, role] of [[sellerBiz, 'seller'], [buyerBiz, 'buyer']]) {
    if (!biz.telegram_bot_token_enc) continue;
    let token;
    try { token = decrypt(biz.telegram_bot_token_enc); } catch { continue; }
    const chat = biz.owner_private_chat_id || biz.owner_telegram_id;
    if (!token || !chat) continue;
    const partner = role === 'seller' ? buyerBiz : sellerBiz;
    const offerLines = offerData ? [
      offerData.product ? `📦 ${offerData.product}` : '',
      offerData.qty     ? `📊 Qty: ${offerData.qty}${offerData.unit ? ' ' + offerData.unit : ''}` : '',
      offerData.price_per_unit ? `💰 ${offerData.price_per_unit} ${offerData.currency || 'ETB'}/unit` : '',
      offerData.total   ? `🧾 Total: ${offerData.total.toLocaleString()} ${offerData.currency || 'ETB'}` : '',
      offerData.delivery ? `🚚 ${offerData.delivery}` : '',
      offerData.payment_terms ? `💳 ${offerData.payment_terms}` : '',
    ].filter(Boolean) : [];

    await tg(token, 'sendMessage', {
      chat_id: chat, parse_mode: 'Markdown',
      text: [
        `🤝 *Deal agreed with ${escapeMd(partner.name)}!*`,
        '',
        ...(offerLines.length ? offerLines : ['_"' + truncate(summary || '', 200) + '"_']),
        '',
        '_Open the dashboard to create an order or follow up._',
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [[
          { text: '📋 View thread', web_app: { url: `${APP_URL}/b2b?thread=${threadId}` } },
        ]],
      },
    });
  }

  return { ok: true, dealId, threadId };
}

/**
 * Extended sendBusinessMessage that also stores negotiation fields.
 * Internal helper used by the auto-negotiation engine.
 */
async function sendBusinessMessageInternal({
  senderBiz, recipientBiz, initiatedBy, intent, content, structured,
  parentId, negotiationRound, offerData, threadStatus, aiGenerated,
}) {
  // Reuse the exported sendBusinessMessage but pass extra fields via structured
  const res = await sendBusinessMessage({
    senderBiz, recipientBiz, initiatedBy, intent, content,
    structured: { ...structured, _offer: offerData, _thread_status: threadStatus },
    parentId,
  });
  if (!res.ok || !res.message?.id) return res;
  // Patch the extra negotiation columns
  try {
    const updates = {};
    if (negotiationRound != null) updates.negotiation_round = negotiationRound;
    if (offerData)     updates.offer_data    = offerData;
    if (threadStatus)  updates.thread_status  = threadStatus;
    if (aiGenerated)   updates.ai_drafted     = true;
    if (Object.keys(updates).length) {
      await supabase().from('business_messages').update(updates).eq('id', res.message.id);
    }
  } catch {}
  return res;
}

// ══════════════════════════════════════════════════════════════════════════════
//  DISCOVERY — find businesses by category/keyword (for Research Agent)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Search discoverable MiniMe businesses by free-text query.
 * Matches across name + description + category + tags (ilike).
 * Returns at most `limit` rows, excluding the searcher's own business.
 *
 * MVP heuristic ranking: businesses with explicit category match first,
 * then tag match, then name match, then description match. Within each
 * bucket, most-recently-active first.
 */
export async function searchBusinessesByCategory(query, { category, limit = 5, excludeId } = {}) {
  const sb = supabase();
  const q = String(query || '').trim();
  if (!q && !category) return [];

  // Build OR conditions across the matchable text fields
  const pattern = `%${q.replace(/[%_]/g, m => '\\' + m)}%`;
  const orParts = [];
  if (q) {
    orParts.push(`name.ilike.${pattern}`);
    orParts.push(`description.ilike.${pattern}`);
    orParts.push(`category.ilike.${pattern}`);
    orParts.push(`tags.cs.{${q.toLowerCase()}}`);
  }
  if (category) {
    orParts.push(`category.ilike.%${category}%`);
  }

  // Defensive: 'tags' may not exist yet; fall back without it on schema error.
  async function runQuery(includeTags) {
    let sel = sb
      .from('businesses')
      .select(`id, name, telegram_bot_username, description, category${includeTags ? ', tags' : ''}, b2b_auto_negotiate, owner_telegram_id, created_at`)
      .eq('b2b_discoverable', true)
      .not('telegram_bot_token_enc', 'is', null);
    if (excludeId) sel = sel.neq('id', excludeId);
    if (orParts.length) sel = sel.or(orParts.filter(p => includeTags || !p.startsWith('tags.')).join(','));
    return sel.limit(limit * 3);
  }
  let { data, error } = await runQuery(true);
  if (error && /column .*tags/i.test(error.message || '')) {
    ({ data, error } = await runQuery(false));
  }
  if (error || !data) return [];

  const ql = q.toLowerCase();
  const ranked = data.map(b => {
    const name = (b.name || '').toLowerCase();
    const desc = (b.description || '').toLowerCase();
    const cat  = (b.category || '').toLowerCase();
    const tags = (b.tags || []).map(t => String(t).toLowerCase());
    let score = 0;
    if (category && cat.includes(String(category).toLowerCase())) score += 100;
    if (ql) {
      if (cat.includes(ql))                  score += 60;
      if (tags.some(t => t.includes(ql)))    score += 50;
      if (name.includes(ql))                 score += 30;
      if (desc.includes(ql))                 score += 10;
    }
    // tiebreaker: newest first
    const age = Date.now() - new Date(b.created_at || 0).getTime();
    score -= Math.min(age / 86400000, 30); // up to -30 for ≥30 days idle
    return { ...b, _score: score };
  }).sort((a, b) => b._score - a._score).slice(0, limit);

  return ranked;
}

/**
 * Fetch a set of businesses by id (helper for dashboard / report rendering).
 */
export async function getBusinessesByIds(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const sb = supabase();
  const { data } = await sb
    .from('businesses')
    .select('id, name, telegram_bot_username, description, category, tags')
    .in('id', ids);
  return data || [];
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
