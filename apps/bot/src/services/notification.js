async function notifyOwnerDraft(bot, business, customer, originalText, draft, confidence, draftMessageId) {
  try {
    if (!business.owner_private_chat_id) return;
    const text = `📬 *Draft Reply for ${customer?.name || 'Customer'}*\n\n` +
                 `*Client*: ${originalText}\n\n` +
                 `*Draft*: ${draft?.reply || draft}\n` +
                 `_Confidence_: ${Math.round((confidence || 0) * 100)}%`;
    await bot.sendMessage(business.owner_private_chat_id, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Send', callback_data: `approve:${draftMessageId}` },
            { text: '✏️ Edit', callback_data: `edit:${draftMessageId}` },
            { text: '❌ Skip', callback_data: `skip:${draftMessageId}` },
          ]
        ]
      }
    });
  } catch (e) {
    console.error('notifyOwnerDraft error:', e.message);
  }
}

async function notifyOwnerAutoSent(bot, business, customer, originalText, sentReply) {
  try {
    if (!business.owner_private_chat_id) return;
    const text = `🤖 *Auto-replied to ${customer?.name || 'Customer'}*\n\n` +
                 `*Client*: ${originalText}\n\n` +
                 `*Bot*: ${sentReply}`;
    await bot.sendMessage(business.owner_private_chat_id, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('notifyOwnerAutoSent error:', e.message);
  }
}

async function notifyOwnerNewMessage(bot, business, customer, text) {
  try {
    if (!business.owner_private_chat_id) return;
    const msg = `💬 *New Message from ${customer?.name || 'Customer'}*\n\n${text}`;
    await bot.sendMessage(business.owner_private_chat_id, msg, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('notifyOwnerNewMessage error:', e.message);
  }
}

async function notifyOwnerSummary(bot, business, customer, summary) {
  try {
    if (!business.owner_private_chat_id) return;

    const text = `📝 *Secretary's Brief: ${customer.name}*\n\n` +
                 `📌 *Gist*: ${summary.summary}\n` +
                 `🎯 *Outcome*: ${summary.outcome}\n` +
                 `⚡ *Next Step*: ${summary.next_step}\n` +
                 `🎭 *Mood*: ${summary.mood}`;

    await bot.sendMessage(business.owner_private_chat_id, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('notifyOwnerSummary error:', e.message);
  }
}

module.exports = { 
  notifyOwnerDraft, 
  notifyOwnerAutoSent, 
  notifyOwnerNewMessage, 
  notifyOwnerSummary 
};
