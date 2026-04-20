const { create: createBusiness, update: updateBusiness, incrementOnboardingStep, findByOwnerTelegramId } = require('../../../../packages/db/queries/businesses');
const { supabase } = require('../../../../packages/db/client');
const { ONBOARDING_QUESTIONS } = require('../../../../packages/shared/constants');
const { analyzeVoiceProfile } = require('../services/ai');

async function handleOnboardingStart(bot, msg) {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;

  const existing = await findByOwnerTelegramId(senderId);

  if (!existing) {
    await createBusiness({
      owner_telegram_id: senderId,
      owner_private_chat_id: chatId,
      name: 'My Business',
      onboarding_step: 0,
      onboarding_completed: false,
    });
  }

  await bot.sendMessage(chatId,
    `🪞 Welcome to *MiniMe!*\n\nI'm your AI business assistant. I'll handle customer messages on Telegram, sounding just like you.\n\nLet's set up your profile — it only takes 5 minutes.\n\n${ONBOARDING_QUESTIONS[0].question}\n\n_${ONBOARDING_QUESTIONS[0].example}_`,
    { parse_mode: 'Markdown' }
  );
}

async function handleOnboardingMessage(bot, msg, business) {
  const chatId = msg.chat.id;
  const step = business.onboarding_step || 0;

  if (msg.text.toLowerCase() === '/skip') {
    await finishOnboarding(bot, business, chatId);
    return;
  }

  if (step === 0) {
    // Save business name
    await updateBusiness(business.id, { name: msg.text, onboarding_step: 1 });
    await bot.sendMessage(chatId, `Great! "${msg.text}" — nice name! 🏪\n\n${ONBOARDING_QUESTIONS[1].question}\n\n_${ONBOARDING_QUESTIONS[1].example}_`, { parse_mode: 'Markdown' });
    return;
  }

  if (step === 1) {
    // Save category
    await updateBusiness(business.id, { category: msg.text, onboarding_step: 2 });
    await bot.sendMessage(chatId,
      `Perfect! Now the important part.\n\n*Step 1: Add me to your business group*\n\n1. Open your business Telegram group\n2. Add me as admin (I need to read & send messages)\n3. Come back here and send me the group name or just type "done"\n\n_Tip: If you don't have a group yet, create one first and add your customers there._`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (step === 2) {
    // They've added the bot to the group (we verify via group membership)
    await updateBusiness(business.id, { onboarding_step: 3 });
    const q = ONBOARDING_QUESTIONS[2];
    await bot.sendMessage(chatId,
      `✅ Got it! Now let's train your voice.\n\n*${q.question}*\n\n_${q.example}_\n\nSend 2-3 examples in your next messages.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Steps 3-9: Voice training questions (maps to ONBOARDING_QUESTIONS[2] through [7])
  if (step >= 3 && step <= 9) {
    const questionIndex = step - 1; // question 2,3,4,5,6,7
    const currentQ = ONBOARDING_QUESTIONS[questionIndex];

    // Save the response
    await supabase.from('onboarding_responses').insert({
      business_id: business.id,
      question_id: currentQ.id,
      question_text: currentQ.question,
      response: msg.text,
    });

    // Also add to sample_replies
    const samples = [...(business.sample_replies || []), msg.text];
    await updateBusiness(business.id, { sample_replies: samples, onboarding_step: step + 1 });

    const nextQ = ONBOARDING_QUESTIONS[step]; // step is now the next index

    if (nextQ) {
      await bot.sendMessage(chatId, `✅ Saved!\n\n*${nextQ.question}*\n\n_${nextQ.example}_`, { parse_mode: 'Markdown' });
    } else {
      // Done with voice questions — analyze
      await bot.sendMessage(chatId, '🔍 Analyzing your communication style...');
      const profile = await analyzeVoiceProfile(samples);
      if (profile) {
        await updateBusiness(business.id, { voice_embedding: profile, onboarding_step: 10 });
      }

      await bot.sendMessage(chatId,
        `🎙️ Voice profile created!\n\nAdd your first product to help MiniMe answer pricing questions:\n\n/addproduct Name, Price, Stock\n\nExample: /addproduct NFC Card, 500, 100\n\nOr type "done" to skip.`
      );
    }
    return;
  }

  if (step === 10) {
    await finishOnboarding(bot, business, chatId);
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
    `🪞 *You're all set!*\n\nMiniMe is now in *Shadow Mode* — I'll watch and learn, but won't send anything yet.\n\nWhen you're ready:\n• /trust — increase my trust level\n• /status — see today's stats\n• /help — all commands\n\nLet customers message your group — I'll start learning! 🚀`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { handleOnboardingStart, handleOnboardingMessage };
