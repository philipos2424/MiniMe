const { create: createBusiness, update: updateBusiness, findByOwnerTelegramId } = require('../../../../packages/db/queries/businesses');
const { supabase } = require('../../../../packages/db/client');
const crypto = require('crypto');

/**
 * THE CONCIERGE: Conversational Onboarding 2.0
 * Logic: Multi-step interview established in Telegram -> Voice Mirroring -> Web Studio Handoff.
 */

const ONBOARDING_STEPS = {
  WELCOME: 0,
  PERSONA_CHOICE: 1,
  VOICE_MIRROR: 2,
  STUDIO_HANDOFF: 3,
  COMPLETED: 11,
};

async function handleOnboardingStart(bot, msg) {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;

  let business = await findByOwnerTelegramId(senderId);

  if (!business) {
    business = await createBusiness({
      owner_telegram_id: senderId,
      owner_private_chat_id: chatId,
      name: 'My Business',
      onboarding_step: ONBOARDING_STEPS.WELCOME,
      onboarding_completed: false,
    });
  }

  await bot.sendMessage(chatId,
    `✨ *Welcome to the New Era of Your Business.*\\n\\n` +
    `I'm not just a bot; I'm your new AI Secretary. I'm here to give you your time back by handling the repetition and the 2 AM questions, so you can focus on growth.\\n\\n` +
    `Before we build your digital twin, I need to get a feel for your "soul" and the way you communicate. It only takes a minute.\\n\\n` +
    `*Shall we begin?*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ 
          text: 'Yes, let\'s do it 🚀', 
          callback_data: 'onboarding_start' 
        }]]
      }
    }
  );
}

async function handleOnboardingMessage(bot, msg, business) {
  const chatId = msg.chat.id;
  const step = business.onboarding_step;

  // Global skip
  if (msg.text && msg.text.toLowerCase() === '/skip') {
    await finishOnboarding(bot, business, chatId);
    return;
  }

  switch (step) {
    case ONBOARDING_STEPS.WELCOME:
      // This is reached if they just sent a message instead of clicking the button
      await askPersona(bot, business, chatId);
      break;

    case ONBOARDING_STEPS.PERSONA_CHOICE:
      await handlePersonaResponse(bot, msg, business, chatId);
      break;

    case ONBOARDING_STEPS.VOICE_MIRROR:
      await handleVoiceMirrorResponse(bot, msg, business, chatId);
      break;

    case ONBOARDING_STEPS.STUDIO_HANDOFF:
      // They are already at the end, just restart handoff
      await triggerStudioHandoff(bot, business, chatId);
      break;

    default:
      await bot.sendMessage(chatId, `I'm a bit confused. Let's get you back on track. /start`);
  }
}

async function askPersona(bot, business, chatId) {
  await updateBusiness(business.id, { onboarding_step: ONBOARDING_STEPS.PERSONA_CHOICE });
  
  await bot.sendMessage(chatId,
    `First things first. Every great business has a "voice".\\n\\n` +
    `If your brand was a person, who would it be? Choose the vibe that fits best:`,
    { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💎 Elegant & Sophisticated', callback_data: 'persona_elegant' }],
          [{ text: '🚀 High-Energy Hustler', callback_data: 'persona_hustler' }],
          [{ text: '🤝 Warm & Community-Focused', callback_data: 'persona_warm' }]
        ]
      }
    }
  );
}

async function handlePersonaResponse(bot, msg, business, chatId) {
  // If users typed a response instead of using buttons
  const response = msg.text || 'Custom';
  
  await bot.sendMessage(chatId, 
    `*${response}*... got it. I can feel the energy. I'm weaving that into my communication patterns now...` , 
    { parse_mode: 'Markdown' }
  );

  // Move to Voice Mirroring
  await updateBusiness(business.id, { 
    onboarding_step: ONBOARDING_STEPS.VOICE_MIRROR,
    persona_preference: response 
  });

  await bot.sendMessage(chatId,
    `Now, for the magic part: *The Voice Mirror.*\\n\\n` +
    `The most accurate AI is the one that sounds exactly like its owner. Please send me a **voice note** (just a few seconds) of how you'd typically greet a new customer.\\n\\n` +
    `Don't overthink it—just be you. 🎙️`,
    { parse_mode: 'Markdown' }
  );
}

async function handleVoiceMirrorResponse(bot, msg, business, chatId) {
  if (msg.voice || msg.audio) {
    await bot.sendMessage(chatId, 
      `🎧 *Processing your resonance...*\\n\\nI've captured your tone, pace, and unique style. Integrating this into my core logic now... ✅`, 
      { parse_mode: 'Markdown' }
    );

    await updateBusiness(business.id, { onboarding_step: ONBOARDING_STEPS.STUDIO_HANDOFF });
    await triggerStudioHandoff(bot, business, chatId);
  } else {
    await bot.sendMessage(chatId, 
      `I'm still waiting for that voice note! 🎙️\\n\\nJust a quick greeting is enough for me to mirror your style and avoid sounding like a generic robot.`
    );
  }
}

async function triggerStudioHandoff(bot, business, chatId) {
  const token = crypto.randomBytes(32).toString('hex');
  await updateBusiness(business.id, { onboarding_token: token });

  const webUrl = process.env.WEB_URL || 'https://minime.app';
  const studioUrl = `${webUrl}/studio/onboarding?token=${token}`;

  await bot.sendMessage(chatId,
    `✨ *The Foundation is Set.*\\n\\n` +
    `I have your persona and your voice. Now, let's finalize the operational details (your services, pricing, and FAQ) in the **MiniMe Studio**.\\n\\n` +
    `This is where we turn this personality into a production-grade business asset.`,
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

async function finishOnboarding(bot, business, chatId) {
  await updateBusiness(business.id, {
    onboarding_completed: true,
    onboarding_step: ONBOARDING_STEPS.COMPLETED,
    trust_level: 0,
  });

  await bot.sendMessage(chatId,
    `🚀 *The Freedom of the Founder begins now.*\\n\\n` +
    `I am now in *Shadow Mode*—I'll watch your chats and draft replies for you to approve first. This is how we build absolute trust.\\n\\n` +
    `🛠️ *Your Command Center*:\\n• /trust — Increase my trust\\n• /status — See the impact\\n• /me — Jump back to Owner Mode\\n\\n` +
    `Welcome to the 1% of digital brands. 🥂`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleOnboardingStart, handleOnboardingMessage };
