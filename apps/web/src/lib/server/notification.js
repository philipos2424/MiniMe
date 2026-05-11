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
export async function notifyOwnerDraft(token, business, customer, originalText, draft, confidence, draftMessageId, intent, flagReason) {
  if (!business.owner_private_chat_id) return;
  const pct = Math.round((confidence || 0) * 100);
  const name = customer?.name || 'Unknown';
  let text = `📩 *New message from ${name}*\n\n_"${originalText}"_\n\n`;
  text += `🪞 *MiniMe Draft (${pct}% match):*\n${draft}`;
  if (flagReason) text += `\n\n⚠️ ${flagReason}`;
  if (intent?.intent) text += `\n\nIntent: ${intent.intent} | ${intent.sentiment || 'neutral'}`;

  await tg(token, 'sendMessage', {
    chat_id: business.owner_private_chat_id,
    text,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `approve_${draftMessageId}` },
          { text: '✏️ Edit', callback_data: `edit_${draftMessageId}` },
        ],
        [{ text: '⏭️ Skip', callback_data: `skip_${draftMessageId}` }],
      ],
    },
  });
}

export async function notifyOwnerAutoSent(token, business, customer, originalText, sentReply, confidence) {
  if (!business.owner_private_chat_id) return;
  const pct = Math.round((confidence || 0) * 100);
  const text = `🤖 *Auto-replied to ${customer?.name || 'Unknown'}*\n\nCustomer: _"${originalText}"_\n\nMiniMe sent: "${sentReply}"\nConfidence: ${pct}%`;
  await tg(token, 'sendMessage', {
    chat_id: business.owner_private_chat_id,
    text,
    parse_mode: 'Markdown',
  });
}

export async function notifyOwnerNewMessage(token, business, customer, messageText, intent) {
  if (!business.owner_private_chat_id) return;
  const text = `📩 *${customer?.name || 'Unknown'}:* ${messageText}\n\n🔍 Intent: ${intent?.intent || '?'} | Sentiment: ${intent?.sentiment || '?'}`;
  await tg(token, 'sendMessage', {
    chat_id: business.owner_private_chat_id,
    text,
    parse_mode: 'Markdown',
  });
}

export async function forwardMessageToOwner(token, business, fromChatId, messageId) {
  if (!business.owner_private_chat_id || !messageId) return;
  try {
    await tg(token, 'forwardMessage', {
      chat_id: business.owner_private_chat_id,
      from_chat_id: fromChatId,
      message_id: messageId,
    });
  } catch (e) { console.warn('forwardMessageToOwner:', e.message); }
}

export async function notifyOwnerScamAlert(token, business, customer, originalText, scan) {
  if (!business.owner_private_chat_id) return;
  const text = `🚨 *Possible scam — not auto-replied*\n\nFrom: ${customer?.name || 'Unknown'}\n_"${originalText}"_\n\nScore: ${Math.round(scan.score * 100)}%\nReasons: ${scan.reasons.slice(0, 3).join('; ')}`;
  await tg(token, 'sendMessage', {
    chat_id: business.owner_private_chat_id,
    text,
    parse_mode: 'Markdown',
  });
}
