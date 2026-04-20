const { findAll: findAllBusinesses } = require('../../../../packages/db/queries/businesses');

async function checkTrials() {
  try {
    const bot = require('../../server').bot;
    const businesses = await findAllBusinesses();
    const now = new Date();

    for (const business of businesses) {
      if (business.subscription_status !== 'trial') continue;
      if (!business.trial_ends_at) continue;

      const trialEnd = new Date(business.trial_ends_at);
      const daysLeft = Math.ceil((trialEnd - now) / 86400000);

      if (!business.owner_private_chat_id) continue;

      if (daysLeft === 3) {
        await bot.sendMessage(business.owner_private_chat_id,
          `⏳ Your MiniMe trial ends in *3 days*!\n\nUpgrade to keep your AI assistant running.\n/upgrade — 2,500 ETB/month`,
          { parse_mode: 'Markdown' }
        );
      } else if (daysLeft === 1) {
        await bot.sendMessage(business.owner_private_chat_id,
          `🚨 Your MiniMe trial ends *tomorrow!*\n\n/upgrade now to avoid interruption.`,
          { parse_mode: 'Markdown' }
        );
      } else if (daysLeft <= 0) {
        const { update } = require('../../../../packages/db/queries/businesses');
        await update(business.id, { subscription_status: 'expired', trust_level: 0 });
        await bot.sendMessage(business.owner_private_chat_id,
          `❌ Your trial has expired. MiniMe is paused.\n\n/upgrade to reactivate.`
        );
      }
    }
  } catch (e) {
    console.error('checkTrials error:', e.message);
  }
}

module.exports = { checkTrials };
