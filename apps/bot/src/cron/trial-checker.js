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

      // NOTE: the free month ending does NOT stop MiniMe. The shop drops to the
      // Free plan — customer replies continue; only the Pro extras lock. Copy
      // here must never imply the bot goes dark, and we must not touch
      // trust_level (that would silently turn off auto-replies).
      if (daysLeft === 3) {
        await bot.sendMessage(business.owner_private_chat_id,
          `⏳ Your free month ends in *3 days*.\n\nAfter that MiniMe keeps answering customers, but Advisor, Broadcast, Secretary and unlimited products lock.\n/upgrade — 2,500 ETB/month`,
          { parse_mode: 'Markdown' }
        );
      } else if (daysLeft === 1) {
        await bot.sendMessage(business.owner_private_chat_id,
          `⏳ Your free month ends *tomorrow*.\n\nMiniMe keeps replying to customers — but you'll lose Advisor, Broadcast and Secretary.\n/upgrade to keep them.`,
          { parse_mode: 'Markdown' }
        );
      } else if (daysLeft <= 0) {
        const { update } = require('../../../../packages/db/queries/businesses');
        await update(business.id, { subscription_status: 'expired' });
        await bot.sendMessage(business.owner_private_chat_id,
          `ℹ️ Your free month is over — you're now on *MiniMe Free*.\n\nMiniMe is still answering your customers. Advisor, Broadcast, Secretary and unlimited products are locked.\n/upgrade to unlock them.`,
          { parse_mode: 'Markdown' }
        );
      }
    }
  } catch (e) {
    console.error('checkTrials error:', e.message);
  }
}

module.exports = { checkTrials };
