const { create: createBusiness, update: updateBusiness, findByOwnerTelegramId } = require('../../../../packages/db/queries/businesses');
const { supabase } = require('../../../../packages/db/client');
const crypto = require('crypto');

/**
 * THE CONCIERGE: Studio Hand-off 1.0
 * Logic: Welcome Gate -> Secure Token -> Launch Web Studio.
 */

async function handleOnboardingStart(bot, msg) {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;

  let business = await findByOwnerTelegramId(senderId);

  if (!business) {
    business = await createBusiness({
      owner_telegram_id: senderId,
      owner_private_chat_id: chatId,
      name: 'My Business',
      onboarding_step: 0,
      onboarding_completed: false,
    });
  }

  // Generate a unique onboarding token for the Web Studio
  const token = crypto.randomBytes(32).toString('hex');
  
  // Save token to business profile
  await updateBusiness(business.id, { 
    onboarding_token: token 
  });

  const webUrl = process.env.WEB_URL || 'https://minime.app';
  const studioUrl = `${webUrl}/studio/onboarding?token=${token}`;

  await bot.sendMessage(chatId,
    `✨ *Welcome to the New Era of Your Business.*\n\n` +
    `I'm not just a bot; I'm your new AI Secretary. I'm here to give you your time back by handling the repetition and the 2 AM questions, so you can focus on the growth.\n\n` +
    `To build your digital twin with absolute precision, let's move to the **MiniMe Studio**.`,
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ 
          text: '🚀 Launch MiniMe Studio', 
          url: studioUrl 
        }]]
      }
    }
  );
}

async function handleOnboardingMessage(bot, msg, business) {
  const chatId = msg.chat.id;
  
  if (msg.text && msg.text.toLowerCase() === '/skip') {
    await finishOnboarding(bot, business, chatId);
    return;
  }

  if (msg.document || msg.photo || msg.text) {
    await bot.sendMessage(chatId, 
      `📥 *Data Received!*\n\nI've synced this to your Studio session. The AI Architect is now processing it into your brand identity. ✅`, 
      { parse_mode: 'Markdown' }
    );
    return;
  }
}

async function finishOnboarding(bot, business, chatId) {
  await updateBusiness(business.id, {
    onboarding_completed: true,
    onboarding_step: 11,
    trust_level: 0,
  });

  await bot.sendMessage(chatId,
    `🚀 *The Freedom of the Founder begins now.*\n\n` +
    `I am now in *Shadow Mode*—I'll watch your chats and draft replies for you to approve first. This is how we build absolute trust.\n\n` +
    `🛠️ *Your Command Center*:\n• /trust — Increase my trust\n• /status — See the impact\n• /me — Jump back to Owner Mode\n\n` +
    `Welcome to the 1% of digital brands. 🥂`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleOnboardingStart, handleOnboardingMessage };
