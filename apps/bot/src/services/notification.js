const { TRUST_LEVEL_NAMES } = require('../../../../packages/shared/constants');

async function notifyOwnerDraft(bot, business, customer, originalMessage, draft, confidence, draftMessageId, intent, flagReason) {
  const ownerChatId = business.owner_private_chat_id;
  if (!ownerChatId) return;

  const pct = Math.round(confidence * 100);
  const customerName = customer?.name || 'Unknown';
  let text = `📩 *New message from ${customerName}*\n\n`;
  text += `_"${originalMessage.content}"_\n\n`;
  text += `🪞 *MiniMe Draft (${pct}% match):*\n${draft}`;
  if (flagReason) text += `\n\n⚠️ ${flagReason}`;
  text += `\n\nIntent: ${intent.intent} | ${intent.sentiment}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve_${draftMessageId}` },
        { text: '✏️ Edit', callback_data: `edit_${draftMessageId}` },
      ],
      [{ text: '⏭️ Skip', callback_data: `skip_${draftMessageId}` }],
    ],
  };

  try {
    await bot.sendMessage(ownerChatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch (e) {
    console.error('notifyOwnerDraft error:', e.message);
  }
}

async function notifyOwnerAutoSent(bot, business, customer, originalMessage, sentReply, confidence) {
  const ownerChatId = business.owner_private_chat_id;
  if (!ownerChatId) return;

  const pct = Math.round(confidence * 100);
  const text = `🤖 *Auto-replied to ${customer?.name || 'Unknown'}*\n\nCustomer: _"${originalMessage}"_\n\nMiniMe sent: "${sentReply}"\nConfidence: ${pct}%`;

  try {
    await bot.sendMessage(ownerChatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('notifyOwnerAutoSent error:', e.message);
  }
}

async function notifyOwnerNewMessage(bot, business, customer, messageText, intent) {
  const ownerChatId = business.owner_private_chat_id;
  if (!ownerChatId) return;

  const text = `📩 *${customer?.name || 'Unknown'}:* ${messageText}\n\n🔍 Intent: ${intent.intent} | Sentiment: ${intent.sentiment}`;

  try {
    await bot.sendMessage(ownerChatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('notifyOwnerNewMessage error:', e.message);
  }
}

async function notifyOwnerTask(bot, business, task) {
  const ownerChatId = business.owner_private_chat_id;
  if (!ownerChatId) return;

  const amount = task.estimated_amount ? ` — ${task.estimated_amount} ETB` : '';
  const text = `🤖 *Agent Task: ${task.title}*\n\n${task.description || ''}${amount}\n\nUrgency: ${task.urgency}`;

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `task_approve_${task.id}` },
      { text: '❌ Reject', callback_data: `task_reject_${task.id}` },
    ]],
  };

  try {
    await bot.sendMessage(ownerChatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  } catch (e) {
    console.error('notifyOwnerTask error:', e.message);
  }
}

async function sendDailySummaryMessage(bot, business, stats) {
  const ownerChatId = business.owner_private_chat_id;
  if (!ownerChatId) return;

  const text =
    `🪞 *MiniMe Daily Summary*\n\n` +
    `📩 Messages: ${stats.total_messages}\n` +
    `🤖 AI handled: ${stats.ai_auto_sent} auto-sent, ${stats.ai_approved} approved\n` +
    `✏️ Edited: ${stats.ai_edited}\n` +
    `👥 New customers: ${stats.new_customers}\n` +
    `💰 Revenue: ${stats.revenue} ETB\n` +
    `😊 Sentiment: ${stats.sentiment_positive}+ ${stats.sentiment_negative}-`;

  try {
    await bot.sendMessage(ownerChatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('sendDailySummaryMessage error:', e.message);
  }
}

module.exports = { notifyOwnerDraft, notifyOwnerAutoSent, notifyOwnerNewMessage, notifyOwnerTask, sendDailySummaryMessage };
