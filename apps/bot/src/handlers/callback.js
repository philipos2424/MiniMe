const { findById: findMessage, updateMessage } = require('../../../../packages/db/queries/messages');
const { findById: findBusiness } = require('../../../../packages/db/queries/businesses');
const { updateConversation } = require('../../../../packages/db/queries/conversations');
const { findById: findTask, updateTask } = require('../../../../packages/db/queries/tasks');
const { setPendingEdit, getPendingEdit, clearPendingEdit } = require('../../../../packages/db/queries/pending_edits');
const negotiation = require('../services/negotiation');

async function handleCallbackQuery(bot, query) {
  try {
    const data = query.data;
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;

    if (data.startsWith('approve_')) {
      const messageId = data.replace('approve_', '');
      const message = await findMessage(messageId);
      if (!message) return bot.answerCallbackQuery(query.id, { text: '❌ Message not found' });

      const business = await findBusiness(message.business_id);
      await bot.sendMessage(business.business_group_chat_id, message.content, {
        reply_to_message_id: message.telegram_message_id,
      });

      await updateMessage(messageId, {
        status: 'sent',
        approved_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        owner_edited: false,
      });

      await updateConversation(message.conversation_id, { requires_owner: false, last_ai_action: 'approved' });

      await bot.editMessageText(`✅ Sent!\n\n"${message.content}"`, { chat_id: chatId, message_id: msgId });
      await bot.answerCallbackQuery(query.id, { text: '✅ Reply sent!' });
    }

    if (data.startsWith('edit_')) {
      const messageId = data.replace('edit_', '');
      await bot.editMessageText(
        '✏️ Send your edited reply now.\nI\'ll send it to the customer.',
        {
          chat_id: chatId,
          message_id: msgId,
          reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `cancel_edit_${messageId}` }]] },
        }
      );
      await setPendingEdit(chatId, messageId);
      await bot.answerCallbackQuery(query.id, { text: '✏️ Send your edited reply' });
    }

    if (data.startsWith('cancel_edit_')) {
      await clearPendingEdit(chatId);
      await bot.editMessageText('❌ Edit cancelled.', { chat_id: chatId, message_id: msgId });
      await bot.answerCallbackQuery(query.id, { text: 'Cancelled' });
    }

    if (data.startsWith('skip_')) {
      const messageId = data.replace('skip_', '');
      await updateMessage(messageId, { status: 'skipped' });
      await bot.editMessageText('⏭️ Skipped. Reply manually in the group.', { chat_id: chatId, message_id: msgId });
      await bot.answerCallbackQuery(query.id, { text: '⏭️ Skipped' });
    }

    if (data.startsWith('task_approve_')) {
      const taskId = data.replace('task_approve_', '');
      await updateTask(taskId, {
        status: 'approved',
        approved_by: 'owner',
        approved_at: new Date().toISOString(),
      });

      const { executeTask } = require('../services/agent');
      await executeTask(bot, taskId);

      await bot.editMessageText('✅ Task approved and executing!', { chat_id: chatId, message_id: msgId });
      await bot.answerCallbackQuery(query.id, { text: '✅ Approved!' });
    }

    if (data.startsWith('task_reject_')) {
      const taskId = data.replace('task_reject_', '');
      await updateTask(taskId, { status: 'cancelled' });
      await bot.editMessageText('❌ Task cancelled.', { chat_id: chatId, message_id: msgId });
      await bot.answerCallbackQuery(query.id, { text: '❌ Cancelled' });
    }

    // ---- Supplier quote actions (from supplierReply.js DMs) ----
    if (data.startsWith('quote_approve_')) {
      const taskId = data.replace('quote_approve_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });

      if (task.status === 'negotiating') {
        const { findByBusiness: findSuppliersForApprove } = require('../../../../packages/db/queries/suppliers');
        const business = await findBusiness(task.business_id);
        const suppliers = await findSuppliersForApprove(task.business_id);
        const supplier = suppliers.find(s => s.name === task.supplier_name);
        await negotiation.acceptDeal(bot, task, business, supplier);
        await bot.answerCallbackQuery(query.id, { text: '✅ Approved' });
        return;
      }

      const quote = task.payload?.latest_quote || {};
      await updateTask(taskId, {
        status: 'approved',
        approved_by: 'owner',
        approved_at: new Date().toISOString(),
        estimated_amount: quote.unit_price && (quote.quantity || 50) ? quote.unit_price * (quote.quantity || 50) : task.estimated_amount,
      });
      await bot.sendMessage(chatId, `✅ Quote approved. Proceed with payment/PO as agreed:\n• ${quote.unit_price || '?'} ${quote.currency || ''} × ${quote.quantity || '?'}\n• Lead time: ${quote.lead_time_days || '?'} days\n• Terms: ${quote.payment_terms || '—'}`);
      await bot.answerCallbackQuery(query.id, { text: '✅ Approved' });
    }

    if (data.startsWith('quote_decline_')) {
      const taskId = data.replace('quote_decline_', '');
      await updateTask(taskId, { status: 'cancelled' });
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      await bot.sendMessage(chatId, '❌ Quote declined. Task cancelled.');
      await bot.answerCallbackQuery(query.id, { text: '❌ Declined' });
    }

    if (data.startsWith('quote_negotiate_')) {
      const taskId = data.replace('quote_negotiate_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      const { findByBusiness: findSuppliersForNegotiate } = require('../../../../packages/db/queries/suppliers');
      const business = await findBusiness(task.business_id);
      const suppliers = await findSuppliersForNegotiate(task.business_id);
      const supplier = suppliers.find(s => s.name === task.supplier_name);

      // First negotiate tap on a task that isn't in a negotiation yet — start one now.
      if (task.status !== 'negotiating') {
        await negotiation.startNegotiation(bot, task, business, supplier);
      }
      const freshTask = await findTask(taskId);
      const draft = await negotiation.draftCounter(freshTask, business, supplier);
      const neg = freshTask.payload.negotiation;
      neg.pending_draft = { text: draft, drafted_at: new Date().toISOString() };
      await updateTask(taskId, { payload: { ...freshTask.payload, negotiation: neg } });

      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      await bot.sendMessage(chatId,
        `💬 *Negotiation draft for ${task.supplier_name}*:\n\n${draft}`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[
            { text: '📤 Send', callback_data: `neg_send_${taskId}` },
            { text: '🚫 Walk away instead', callback_data: `neg_walk_${taskId}` },
          ]] },
        }
      );
      await bot.answerCallbackQuery(query.id, { text: '💬 Draft ready' });
    }

    if (data.startsWith('neg_send_')) {
      const taskId = data.replace('neg_send_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      const business = await findBusiness(task.business_id);
      const { findByBusiness: findSuppliersForSend } = require('../../../../packages/db/queries/suppliers');
      const suppliers = await findSuppliersForSend(task.business_id);
      const supplier = suppliers.find(s => s.name === task.supplier_name);
      const draftText = task.payload?.negotiation?.pending_draft?.text;
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      if (!draftText) return bot.answerCallbackQuery(query.id, { text: '❌ No draft found' });
      await negotiation.sendCounter(bot, task, business, supplier, draftText);
      await bot.answerCallbackQuery(query.id, { text: '📤 Sent' });
    }

    if (data.startsWith('neg_walk_')) {
      const taskId = data.replace('neg_walk_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      const business = await findBusiness(task.business_id);
      const { findByBusiness: findSuppliersForWalk } = require('../../../../packages/db/queries/suppliers');
      const suppliers = await findSuppliersForWalk(task.business_id);
      const supplier = suppliers.find(s => s.name === task.supplier_name);
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      await negotiation.walkAway(bot, task, business, supplier, 'Owner chose to walk away');
      await bot.answerCallbackQuery(query.id, { text: '🚫 Walked away' });
    }

    if (data.startsWith('neg_accept_')) {
      const taskId = data.replace('neg_accept_', '');
      const task = await findTask(taskId);
      if (!task) return bot.answerCallbackQuery(query.id, { text: '❌ Task not found' });
      const business = await findBusiness(task.business_id);
      const { findByBusiness: findSuppliersForAccept } = require('../../../../packages/db/queries/suppliers');
      const suppliers = await findSuppliersForAccept(task.business_id);
      const supplier = suppliers.find(s => s.name === task.supplier_name);
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      await negotiation.acceptDeal(bot, task, business, supplier);
      await bot.answerCallbackQuery(query.id, { text: '✅ Accepted' });
    }

    if (data.startsWith('trust_set_')) {
      const level = parseInt(data.replace('trust_set_', ''));
      const { findByOwnerTelegramId, setTrustLevel } = require('../../../../packages/db/queries/businesses');
      const business = await findByOwnerTelegramId(query.from.id);
      if (!business) return bot.answerCallbackQuery(query.id, { text: '❌ Business not found' });

      await setTrustLevel(business.id, level);
      const { TRUST_LEVEL_NAMES } = require('../../../../packages/shared/constants');
      const lvl = TRUST_LEVEL_NAMES[level];
      await bot.editMessageText(`${lvl.emoji} Trust level set to: ${lvl.en} (${lvl.am})`, { chat_id: chatId, message_id: msgId });
      await bot.answerCallbackQuery(query.id, { text: `Set to ${lvl.en}` });
    }

    if (data.startsWith('negmode_')) {
      const mode = data.replace('negmode_', '');
      const { findByOwnerTelegramId, update: updateBusiness } = require('../../../../packages/db/queries/businesses');
      const business = await findByOwnerTelegramId(query.from.id);
      if (!business) return bot.answerCallbackQuery(query.id, { text: '❌ Business not found' });

      const minTrust = { draft: 0, auto: 2, full: 3 }[mode];
      if (business.trust_level < minTrust) {
        return bot.answerCallbackQuery(query.id, { text: `❌ Requires trust level ${minTrust}+` });
      }
      await updateBusiness(business.id, { negotiation_mode: mode });
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      await bot.sendMessage(chatId, `✅ Negotiation mode set to *${mode}*.`, { parse_mode: 'Markdown' });
      await bot.answerCallbackQuery(query.id, { text: '✅ Updated' });
    }

    // Order fulfillment / refund (from the "payment received" DM)
    if (data.startsWith('order_fulfill_')) {
      const orderId = data.replace('order_fulfill_', '');
      const { findById: findOrder, markFulfilled } = require('../../../../packages/db/queries/orders');
      const order = await findOrder(orderId);
      if (!order) return bot.answerCallbackQuery(query.id, { text: '❌ Order not found' });
      await markFulfilled(orderId);
      await bot.editMessageText(`✅ Order fulfilled — ${order.total} ${order.currency} · ${order.customers?.name || 'customer'}`,
        { chat_id: chatId, message_id: msgId });
      await bot.answerCallbackQuery(query.id, { text: '✅ Marked fulfilled' });

      // Tell the customer
      if (order.customers?.telegram_id) {
        try {
          await bot.sendMessage(order.customers.telegram_id,
            `📦 Your order is on its way! Thanks again — ${order.customers.name || ''}`.trim());
        } catch (_) {}
      }
    }

    if (data.startsWith('order_refund_')) {
      const orderId = data.replace('order_refund_', '');
      const { update: updateOrder } = require('../../../../packages/db/queries/orders');
      await updateOrder(orderId, { status: 'refunded', owner_note: 'Refund initiated by owner' });
      await bot.editMessageText(`↩️ Order marked for refund. Process it in Chapa dashboard.`,
        { chat_id: chatId, message_id: msgId });
      await bot.answerCallbackQuery(query.id, { text: 'Marked refunded' });
    }

  } catch (error) {
    console.error('Callback handler error:', error);
    try { await bot.answerCallbackQuery(query.id, { text: '❌ Error occurred' }); } catch (_) {}
  }
}

module.exports = { handleCallbackQuery };
