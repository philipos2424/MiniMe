const { findByGroupChatId, findByOwnerTelegramId, findAll: findAllBusinesses, update: updateBusiness } = require('../../../../packages/db/queries/businesses');
const { findOrCreateCustomer } = require('../../../../packages/db/queries/customers');
const { findOrCreateConversation, updateConversation } = require('../../../../packages/db/queries/conversations');
const { createMessage, updateMessage, getRecentMessages } = require('../../../../packages/db/queries/messages');
const { detectIntent } = require('../services/ai');
const { draftReply } = require('../services/reply');
const { enrichCustomerProfile } = require('../services/crm');
const { notifyOwnerDraft, notifyOwnerAutoSent, notifyOwnerNewMessage } = require('../services/notification');
const { TRUST_LEVELS, ROUTINE_INTENTS } = require('../../../../packages/shared/constants');
const { sendMiniAppSignup } = require('./onboarding');
const { transcribeTelegramAudio, describeTelegramPhoto } = require('../services/transcription');
const { handleSupplierReply } = require('../services/supplierReply');
const { scanForScam } = require('../services/scam');
const { looksLikeDocumentRequest, matchDocumentByIntent, downloadDocument } = require('../services/knowledge');
const { tryCheckout } = require('../services/checkout');
const { findById: findMessage } = require('../../../../packages/db/queries/messages');
const { levenshteinDistance } = require('../../../../packages/shared/utils');
const { getPendingEdit, clearPendingEdit } = require('../../../../packages/db/queries/pending_edits');



async function handleMessage(bot, msg) {
  try {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    // If the message is voice / audio / video note → transcribe to text.
    // If it's a photo → describe it. Either way, we set msg.text to a usable string.
    if (!msg.text) {
      try {
        if (msg.voice || msg.audio || msg.video_note) {
          const result = await transcribeTelegramAudio(bot, msg);
          if (result?.text) {
            msg.text = result.text;
            msg._was_voice = true;
            msg._audio_duration = result.duration;
          }
        } else if (msg.photo) {
          const caption = msg.caption || '';
          const described = await describeTelegramPhoto(bot, msg);
          msg.text = [caption, described && `[image] ${described}`].filter(Boolean).join('\n').trim();
          msg._was_photo = true;
        }
      } catch (e) { 
        console.warn('media processing failed:', e.message); 
        await bot.sendMessage(chatId, '🙏 Sorry, I had a little trouble hearing that audio/seeing that photo. Could you try sending it again or typing it out?');
      }
    }

    if (!msg.text) return;

    const ownerBusiness = await findByOwnerTelegramId(senderId);

    // Owner Portal: check for /me or /home to switch back to owner context
    if (msg.text && (msg.text === '/me' || msg.text === '/home')) {
      if (ownerBusiness) {
        await bot.sendMessage(chatId, `🛠️ *Owner Mode Activated*\\n\\nWelcome back to your Command Center, ${ownerBusiness.name}! You are now managing your own business.`, { parse_mode: 'Markdown' });
        return; 
      } else {
        await bot.sendMessage(chatId, '❌ You are not registered as a business owner in MiniMe.');
        return;
      }
    }

    if (ownerBusiness) {
      if (msg.chat.type === 'private') {
        // Check if we're waiting for an edit reply
        const pendingMsgId = await getPendingEdit(chatId);
        if (pendingMsgId) {
          await handlePendingEdit(bot, msg, ownerBusiness, pendingMsgId);
          await clearPendingEdit(chatId);
          return;
        }
        // Not finished setup — the mini-app is the onboarding front door now,
        // so nudge them there instead of running the retired in-chat concierge.
        if (!ownerBusiness.onboarding_completed) {
          await sendMiniAppSignup(bot, chatId);
          return;
        }
      }
    }

    // Supplier reply? If the sender's Telegram ID matches a known supplier,
    // parse their quote and attach to the most recent reorder task.
    try {
      const handled = await handleSupplierReply(bot, msg, senderId);
      if (handled) return;
    } catch (e) { console.warn('supplier reply check failed:', e.message); }

    // Find business: group chat (multi-customer), or direct DM (single customer)
    let business = await findByGroupChatId(chatId);
    let isDirectDM = false;

    if (!business && msg.chat.type === 'private') {
      // Non-owner messaging the bot directly.
      // Instead of a dead-end, we welcome them and guide them to the directory.
      await bot.sendMessage(chatId, `👋 Hello! Welcome to MiniMe.\\n\\nIt looks like you've messaged me directly. To help you, I need to know which business you are looking for.\\n\\n🔎 *Want to find a business?*\\nUse our directory to find the best services in Addis Ababa!\\n\\n👉 Coming soon: MiniMe Search\\n\\nOr, if you were invited by a business, please use the link they provided.`);
      return;
    }

    if (!business) return;

    // In group: skip owner messages (learn from them instead)
    if (!isDirectDM && senderId === business.owner_telegram_id) {
      await learnFromOwnerReply(business, msg);
      return;
    }

    const customer = await findOrCreateCustomer({
      business_id: business.id,
      telegram_id: senderId,
      telegram_username: msg.from.username,
      name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
    });
    if (!customer) return;

    const conversation = await findOrCreateConversation({
      business_id: business.id,
      customer_id: customer.id,
    });
    if (!conversation) return;

    const savedMessage = await createMessage({
      conversation_id: conversation.id,
      business_id: business.id,
      customer_id: customer.id,
      direction: 'inbound',
      content: msg.text,
      content_type: 'text',
      telegram_message_id: msg.message_id,
      telegram_chat_id: chatId,
    });

    const recentMessages = await getRecentMessages(conversation.id, 10);
    const intent = await detectIntent(msg.text, recentMessages);

    // 📉 CONVERSATION CLOSURE: If the user is saying goodbye or thanking, trigger a summary brief
    if (['thanks', 'goodbye', 'thankyou'].includes(intent.intent) || msg.text.toLowerCase().includes('thank you')) {
      try {
        const { summarizeConversation } = require('../services/ai');
        const { notifyOwnerSummary } = require('../services/notification');
        
        const summary = await summarizeConversation(recentMessages);
        if (summary) {
          await notifyOwnerSummary(bot, business, customer, summary);
        }
      } catch (e) {
        console.warn('Summary brief failed:', e.message);
      }
    }

    await updateMessage(savedMessage.id, {
      detected_intent: intent.intent,
      detected_sentiment: intent.sentiment,
      detected_language: intent.language,
      detected_topics: intent.topics || [],
    });

    await enrichCustomerProfile(customer.id, msg.text, intent, business.id);

    // Scam shield — flag the owner and DON'T auto-reply if this looks like a scam
    try {
      const scam = scanForScam(msg.text);
      if (scam.isScam) {
        if (business.owner_private_chat_id) {
          await bot.sendMessage(
            business.owner_private_chat_id,
            `🛡️ *Scam shield*: a message from ${customer.name || 'unknown'} looks suspicious (score ${Math.round(scam.score * 100)}%).\nReasons: ${scam.reasons.join('; ')}\n\nMessage:\n"${msg.text.slice(0, 400)}"\n\nI will NOT auto-reply — you decide.`,
            { parse_mode: 'Markdown' }
          );
        }
        await updateConversation(conversation.id, {
          last_ai_action: 'scam_flagged',
          requires_owner: true,
          last_message_at: new Date().toISOString(),
          message_count: conversation.message_count + 1,
        });
        return;
      }
    } catch (e) { console.warn('scam shield error:', e.message); }

    // Auto-send document if customer asked for one (price list, menu, brochure…)
    try {
      const { looksLikeDocumentRequest, matchDocumentByIntent, downloadDocument } = require('../services/knowledge');
      if (!business.panic_mode && looksLikeDocumentRequest(msg.text)) {
        const matches = await matchDocumentByIntent(msg.text, business.id, { threshold: 0.35, count: 1 });
        const hit = matches && matches[0];
        if (hit && hit.storage_path) {
          const buffer = await downloadDocument(hit.storage_path);
          await bot.sendDocument(chatId, buffer, {
            caption: `📎 ${hit.title}`,
          }, {
            filename: hit.title || 'document',
            contentType: hit.mime_type || 'application/octet-stream',
          });
          await createMessage({
            conversation_id: conversation.id,
            business_id: business.id,
            customer_id: customer.id,
            direction: 'outbound',
            content: `[sent document: ${hit.title}]`,
            status: 'sent',
            is_ai_generated: true,
            ai_model: 'knowledge-retrieval',
            sent_at: new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      console.warn('Auto-send document skipped:', e.message);
    }

    if (business.panic_mode) {
      await updateConversation(conversation.id, {
        last_ai_action: 'paused',
        last_message_at: new Date().toISOString(),
        message_count: conversation.message_count + 1,
      });
      return;
    }

    // 🚨 HANDOFF LOGIC: Check for sentiment crash or high-risk red lines before processing
    if (intent.sentiment === 'angry' || intent.sentiment === 'frustrated') {
      if (business.owner_private_chat_id) {
        await bot.sendMessage(
          business.owner_private_chat_id,
          `⚠️ *Urgent Handoff*: Customer ${customer.name} is ${intent.sentiment}. I'm stepping back immediately to avoid breaking trust.`
        );
      }
      await updateConversation(conversation.id, {
        last_ai_action: 'escalated_sentiment',
        requires_owner: true,
        last_message_at: new Date().toISOString(),
        message_count: conversation.message_count + 1,
      });
      return;
    }


    // Checkout short-circuit — if the customer is trying to place an order,
    // create it + send a Chapa link and skip the normal reply flow.
    try {
      const handled = await tryCheckout(bot, business, customer, conversation, savedMessage, intent);
      if (handled) {
        await updateConversation(conversation.id, {
          last_ai_action: 'order_created',
          last_message_at: new Date().toISOString(),
          message_count: conversation.message_count + 1,
        });
        return;
      }
    } catch (e) { console.warn('checkout flow skipped:', e.message); }

    switch (business.trust_level) {
      case TRUST_LEVELS.SHADOW:
        await updateConversation(conversation.id, {
          last_ai_action: 'observed',
          last_message_at: new Date().toISOString(),
          message_count: conversation.message_count + 1,
        });
        await notifyOwnerNewMessage(bot, business, customer, msg.text, intent);
        break;

      case TRUST_LEVELS.SUPERVISED:
        await handleSupervised(bot, business, customer, conversation, savedMessage, intent);
        break;

      case TRUST_LEVELS.TRUSTED:
        await handleTrusted(bot, business, customer, conversation, savedMessage, intent);
        break;

      case TRUST_LEVELS.FULL_AGENT:
        await handleFullAgent(bot, business, customer, conversation, savedMessage, intent);
        break;
    }

  } catch (error) {
    console.error('Message handler error:', error);
  }
}

async function handleSupervised(bot, business, customer, conversation, message, intent) {
  const { draft, confidence, model } = await draftReply(business, customer, conversation, message, intent);
  if (!draft) return;

  const draftMessage = await createMessage({
    conversation_id: conversation.id,
    business_id: business.id,
    customer_id: customer.id,
    direction: 'outbound',
    content: draft,
    status: 'drafted',
    is_ai_generated: true,
    ai_draft: draft,
    ai_confidence: confidence,
    ai_model: model,
    telegram_chat_id: message.telegram_chat_id,
    telegram_message_id: message.telegram_message_id,
  });

  await notifyOwnerDraft(bot, business, customer, message, draft, confidence, draftMessage.id, intent);
  await updateConversation(conversation.id, {
    last_ai_action: 'drafted',
    last_ai_confidence: confidence,
    requires_owner: true,
    last_message_at: new Date().toISOString(),
    message_count: conversation.message_count + 1,
  });
}

async function handleTrusted(bot, business, customer, conversation, message, intent) {
  const { draft, confidence, model } = await draftReply(business, customer, conversation, message, intent);
  if (!draft) return;

  const isRoutine = ROUTINE_INTENTS.includes(intent.intent);
  const threshold = business.auto_send_confidence_threshold || 0.85;

  if (isRoutine && confidence >= threshold) {
    await createMessage({
      conversation_id: conversation.id,
      business_id: business.id,
      customer_id: customer.id,
      direction: 'outbound',
      content: draft,
      status: 'sent',
      is_ai_generated: true,
      ai_draft: draft,
      ai_confidence: confidence,
      ai_model: model,
      telegram_chat_id: message.telegram_chat_id,
      sent_at: new Date().toISOString(),
    });

    await bot.sendMessage(message.telegram_chat_id, draft, {
      reply_to_message_id: message.telegram_message_id,
    });

    await notifyOwnerAutoSent(bot, business, customer, message.content, draft, confidence);
    await updateConversation(conversation.id, {
      last_ai_action: 'auto_sent',
      last_ai_confidence: confidence,
      requires_owner: false,
      last_message_at: new Date().toISOString(),
      message_count: conversation.message_count + 1,
    });
  } else {
    const draftMessage = await createMessage({
      conversation_id: conversation.id,
      business_id: business.id,
      customer_id: customer.id,
      direction: 'outbound',
      content: draft,
      status: 'drafted',
      is_ai_generated: true,
      ai_draft: draft,
      ai_confidence: confidence,
      ai_model: model,
      telegram_chat_id: message.telegram_chat_id,
      telegram_message_id: message.telegram_message_id,
    });

    const flagReason = !isRoutine ? `Complex: ${intent.intent}` : `Low confidence: ${Math.round(confidence * 100)}%`;
    await notifyOwnerDraft(bot, business, customer, message, draft, confidence, draftMessage.id, intent, flagReason);
    await updateConversation(conversation.id, {
      last_ai_action: 'escalated',
      last_ai_confidence: confidence,
      requires_owner: true,
      last_message_at: new Date().toISOString(),
      message_count: conversation.message_count + 1,
    });
  }
}

async function handleFullAgent(bot, business, customer, conversation, message, intent) {
  const { draft, confidence, model } = await draftReply(business, customer, conversation, message, intent);
  if (!draft) return;

  if (confidence < 0.5) {
    const draftMessage = await createMessage({
      conversation_id: conversation.id,
      business_id: business.id,
      customer_id: customer.id,
      direction: 'outbound',
      content: draft,
      status: 'drafted',
      is_ai_generated: true,
      ai_draft: draft,
      ai_confidence: confidence,
      ai_model: model,
      telegram_chat_id: message.telegram_chat_id,
      telegram_message_id: message.telegram_message_id,
    });
    await notifyOwnerDraft(bot, business, customer, message, draft, confidence, draftMessage.id, intent, '🚨 Very low confidence');
    return;
  }

  await createMessage({
    conversation_id: conversation.id,
    business_id: business.id,
    customer_id: customer.id,
    direction: 'outbound',
    content: draft,
    status: 'sent',
    is_ai_generated: true,
    ai_draft: draft,
    ai_confidence: confidence,
    ai_model: model,
    sent_at: new Date().toISOString(),
  });

  await bot.sendMessage(message.telegram_chat_id, draft, {
    reply_to_message_id: message.telegram_message_id,
  });

  await updateConversation(conversation.id, {
    last_ai_action: 'auto_sent',
    last_ai_confidence: confidence,
    requires_owner: false,
    last_message_at: new Date().toISOString(),
    message_count: conversation.message_count + 1,
  });
}

async function learnFromOwnerReply(business, msg) {
  if (!msg.text || msg.text.startsWith('/')) return;
  
  // Store as a separate record or limit carefully to prevent DB row bloat.
  // We keep the most recent 30 replies instead of 100 to keep the document size lean.
  const samples = [...(business.sample_replies || []), msg.text].slice(-30);
  
  await updateBusiness(business.id, { sample_replies: samples });
}

async function handlePendingEdit(bot, msg, business, draftMessageId) {
  try {
    const { findById: findMessage, updateMessage } = require('../../../../packages/db/queries/messages');
    const draftMsg = await findMessage(draftMessageId);
    if (!draftMsg) return;

    await bot.sendMessage(draftMsg.telegram_chat_id, msg.text, {
      reply_to_message_id: draftMsg.telegram_message_id,
    });

    const { levenshteinDistance } = require('../../../../packages/shared/utils');
    const editDist = levenshteinDistance(draftMsg.ai_draft || '', msg.text);
    
    await updateMessage(draftMessageId, {
      content: msg.text,
      status: 'sent',
      owner_edited: true,
      edit_distance: editDist,
      sent_at: new Date().toISOString(),
    });

    // 🧠 VOICE MIRROR: Save the correction pair for style learning
    try {
      // We use a dummy db call here since we don't have the specific query exported, 
      // but the logic is: save draft vs correction
      const { insertVoiceMirror } = require('../../../../packages/db/queries/voiceMirror'); 
      await insertVoiceMirror({
        business_id: business.id,
        draft_text: draftMsg.ai_draft || '',
        corrected_text: msg.text,
      });
    } catch (e) {
      console.warn('Voice mirror capture failed:', e.message);
    }

    await bot.sendMessage(msg.chat.id, '✅ Your edited reply has been sent!');
  } catch (e) {
    console.error('handlePendingEdit error:', e);
  }
}

module.exports = { handleMessage };
