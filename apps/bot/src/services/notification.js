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

async function notifyOwnerLeadCard(bot, business, leadCard) {
  try {
    if (!business.owner_private_chat_id) return;
    
    const typeLabels = {
      'b2b_qualified': '🌟 Qualified B2B (Manifest)',
      'b2b_lead': '🔍 Discovery Lead',
      'supplier': '📦 Supplier Reorder',
      'customer': '👥 Customer Follow-up'
    };
    
    const label = typeLabels[leadCard.target_type] || '🎯 New Lead';
    const trustLabels = {
      0: '👻 SHADOW (Observe only)',
      1: '👮 SUPERVISED (Draft only)',
      2: '🤝 TRUSTED (Auto-send routine)',
      3: '🤖 FULL_AGENT (Full autonomy)'
    };
    const trustLabel = trustLabels[leadCard.trust_level] || 'Unknown';
    
    let text = `🎯 **${label}**\n`;
    text += `────────────────────\n`;
    text += `👤 **Who:** ${leadCard.target_name || 'Unknown'}\n`;
    if (leadCard.analysis) text += `\n💡 **Why (Synergy):**\n${leadCard.analysis}\n`;
    text += `\n📝 **Proposed Draft:**\n\n${leadCard.proposed_draft}\n`;
    text += `────────────────────\n`;
    text += `\n🔐 **Trust Level:** ${trustLabel}`;
    if (leadCard.confidence) text += `\n📊 **Confidence:** ${Math.round(leadCard.confidence * 100)}%`;
    text += `\n\n👉 *Reply **YES** to send, or type your changes to edit.*`;

    await bot.sendMessage(business.owner_private_chat_id, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Send as-is', callback_data: `leadcard_approve:${leadCard.id}` },
            { text: '✏️ Edit & Send', callback_data: `leadcard_edit:${leadCard.id}` },
          ],
          [
            { text: '❌ Reject', callback_data: `leadcard_reject:${leadCard.id}` },
          ]
        ]
      }
    });
  } catch (e) {
    console.error('notifyOwnerLeadCard error:', e.message);
  }
}

module.exports = { 
  notifyOwnerDraft, 
  notifyOwnerAutoSent, 
  notifyOwnerNewMessage, 
  notifyOwnerSummary,
  notifyOwnerLeadCard
};
