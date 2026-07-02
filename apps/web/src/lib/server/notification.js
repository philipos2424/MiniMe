/**
 * Owner-facing notifications. Uses tg() (raw Bot API) instead of a bot instance.
 */

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j?.ok) console.warn(`tg ${method}:`, j?.description);
  return j;
}

/**
 * Post a draft reply to the owner's private chat with Approve/Edit/Skip buttons.
 * draftMessageId = the messages row id of the saved draft (so callbacks can find it).
 */
function ownerChat(business) {
  return business.owner_private_chat_id || business.owner_telegram_id || null;
}

/**
 * Decide whether a draft notification is important enough to ping the owner.
 * Returns true only for messages that genuinely need human attention.
 * Routine messages (greetings, simple price checks) can stay silent in the
 * Mini App inbox without buzzing the owner's phone every time.
 */
export function isImportantForOwner(confidence, intent, flagReason, isNewCustomer = false) {
  // Always ping for low confidence — AI wasn't sure
  if ((confidence ?? 1) < 0.55) return true;
  // Always ping for flagged messages (scam, complaint etc.)
  if (flagReason) return true;
  // Always ping the first time a new customer writes
  if (isNewCustomer) return true;
  // Always ping for high-urgency intents
  const urgentIntents = ['complaint', 'negotiation', 'urgent', 'refund', 'problem', 'issue'];
  if (intent?.intent && urgentIntents.includes(intent.intent)) return true;
  // Always ping if sentiment is negative
  if (intent?.sentiment === 'negative') return true;
  // Otherwise: let it sit in the Mini App inbox silently
  return false;
}

export async function notifyOwnerDraft(token, business, customer, originalText, draft, confidence, draftMessageId, intent, flagReason, conversationId, { isNewCustomer = false } = {}) {
  if (!ownerChat(business)) return;
  const pct = Math.round((confidence || 0) * 100);
  const name = customer?.name || 'Unknown';
  const lowConfidence = (confidence ?? 1) < 0.55;

  // Respect owner's notification_prefs.silent_drafts setting
  // If they've turned off draft pings, only send truly important ones
  const silentMode = business.notification_prefs?.silent_drafts === true;
  if (silentMode && !isImportantForOwner(confidence, intent, flagReason, isNewCustomer)) return;

  // Platform badge so owner knows which channel this is from
  const platformBadge = originalText?.startsWith('[📱 WhatsApp]') ? '📱 WhatsApp · '
    : originalText?.startsWith('[📸 Instagram]') ? '📸 Instagram · '
    : originalText?.startsWith('[👥 Facebook]') ? '👥 Facebook · '
    : '';
  const cleanText = originalText?.replace(/^\[(📱 WhatsApp|📸 Instagram|👥 Facebook)\]\s*/, '') || originalText;

  let text;
  if (lowConfidence) {
    text = `⚠️ *${platformBadge}I wasn't sure how to handle this one from ${name}.*\n\n_"${cleanText}"_\n\n🪞 *My best draft (${pct}% match):*\n${draft}\n\n_Was this draft helpful? Approve to send, edit, or tell me it missed._`;
  } else {
    text = `📩 *${platformBadge}New message from ${name}*\n\n_"${cleanText}"_\n\n`;
    text += `🪞 *MiniMe Draft (${pct}% match):*\n${draft}`;
  }
  if (flagReason) text += `\n\n⚠️ ${flagReason}`;
  if (intent?.intent && !lowConfidence) text += `\n\nIntent: ${intent.intent} | ${intent.sentiment || 'neutral'}`;

  // Build a deep-link "Open conversation" button if we have the Mini App URL
  const MINIAPP_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.MINIAPP_URL || '';
  const openInAppRow = MINIAPP_URL && conversationId
    ? [[{
        text: '📱 Open conversation',
        web_app: { url: `${MINIAPP_URL.replace(/\/$/, '')}/conversations/${conversationId}?focusDraft=1` },
      }]]
    : [];

  // Low-confidence drafts also get an explicit 👎 "missed it" feedback button
  const fbRow = lowConfidence
    ? [[{ text: '👎 Missed it', callback_data: `fb_no_draft_${draftMessageId}` }]]
    : [];

  await tg(token, 'sendMessage', {
    chat_id: ownerChat(business),
    text,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve_${draftMessageId}` },
          { text: '✏️ Edit', callback_data: `edit_${draftMessageId}` },
        ],
        [{ text: '⏭️ Skip', callback_data: `skip_${draftMessageId}` }],
        ...fbRow,
        ...openInAppRow,
      ],
    },
  });
}

export async function notifyOwnerAutoSent(token, business, customer, originalText, sentReply, confidence, options = {}) {
  if (!ownerChat(business)) return;
  const pct   = Math.round((confidence || 0) * 100);
  const name  = customer?.name || 'Unknown';
  const { conversationId, isSecretary } = options;

  const badge  = isSecretary ? '📱 *Replied as you* (Secretary Mode)' : '🤖 *Auto-replied*';
  const to     = isSecretary ? `to *${name}* on your personal Telegram` : `to *${name}*`;
  const msgPreview = originalText.length > 120 ? originalText.slice(0, 120) + '…' : originalText;
  const replyPreview = sentReply.length > 200 ? sentReply.slice(0, 200) + '…' : sentReply;

  const text = `${badge} ${to}\n\n_"${msgPreview}"_\n\n✉️ Sent: "${replyPreview}"\n\n_Confidence: ${pct}% · ${isSecretary ? 'Customer sees this as coming from you' : 'Auto-sent'}_`;

  const MINIAPP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').trim();
  const rows = [];
  if (MINIAPP_URL && conversationId) {
    rows.push([{
      text: '📱 Open conversation',
      web_app: { url: `${MINIAPP_URL}/conversations/${conversationId}` },
    }]);
  }

  await tg(token, 'sendMessage', {
    chat_id: ownerChat(business),
    text,
    parse_mode: 'Markdown',
    ...(rows.length ? { reply_markup: { inline_keyboard: rows } } : {}),
  });
}

export async function notifyOwnerNewMessage(token, business, customer, messageText, intent) {
  if (!ownerChat(business)) return;
  const text = `📩 *${customer?.name || 'Unknown'}:* ${messageText}\n\n🔍 Intent: ${intent?.intent || '?'} | Sentiment: ${intent?.sentiment || '?'}`;
  await tg(token, 'sendMessage', {
    chat_id: ownerChat(business),
    text,
    parse_mode: 'Markdown',
  });
}

export async function forwardMessageToOwner(token, business, fromChatId, messageId) {
  if (!ownerChat(business) || !messageId) return;
  try {
    await tg(token, 'forwardMessage', {
      chat_id: ownerChat(business),
      from_chat_id: fromChatId,
      message_id: messageId,
    });
  } catch (e) { console.warn('forwardMessageToOwner:', e.message); }
}

export async function notifyOwnerScamAlert(token, business, customer, originalText, scan) {
  if (!ownerChat(business)) return;
  const text = `🚨 *Possible scam — not auto-replied*\n\nFrom: ${customer?.name || 'Unknown'}\n_"${originalText}"_\n\nScore: ${Math.round(scan.score * 100)}%\nReasons: ${scan.reasons.slice(0, 3).join('; ')}`;
  await tg(token, 'sendMessage', {
    chat_id: ownerChat(business),
    text,
    parse_mode: 'Markdown',
  });
}
