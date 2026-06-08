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
