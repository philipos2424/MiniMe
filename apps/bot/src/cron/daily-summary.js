const { findAll: findAllBusinesses } = require('../../../../packages/db/queries/businesses');
const { getForDate } = require('../../../../packages/db/queries/analytics');
const { sendDailySummaryMessage } = require('../services/notification');

let botRef = null;
function setBot(bot) { botRef = bot; }

async function sendDailySummaries() {
  try {
    if (!botRef) {
      botRef = require('../../server').bot;
    }
    const businesses = await findAllBusinesses();
    const today = new Date().toISOString().split('T')[0];

    for (const business of businesses) {
      if (!business.owner_private_chat_id) continue;
      const stats = await getForDate(business.id, today);
      if (!stats) continue;
      await sendDailySummaryMessage(botRef, business, stats);
    }
  } catch (e) {
    console.error('sendDailySummaries error:', e.message);
  }
}

module.exports = { sendDailySummaries, setBot };
