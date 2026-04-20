const cron = require('node-cron');

function setupCronJobs(bot) {
  // Daily analytics — midnight EAT (21:00 UTC)
  cron.schedule('0 21 * * *', async () => {
    const { aggregateAllBusinesses } = require('./analytics');
    await aggregateAllBusinesses();
  });

  // Daily summary to owners — 8 PM EAT (17:00 UTC)
  cron.schedule('0 17 * * *', async () => {
    const { sendDailySummaries } = require('./daily-summary');
    await sendDailySummaries();
  });

  // Agent checks — every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    const { runAgentChecks } = require('./agent-checks');
    await runAgentChecks();
  });

  // Trial expiry — daily noon EAT (09:00 UTC)
  cron.schedule('0 9 * * *', async () => {
    const { checkTrials } = require('./trial-checker');
    await checkTrials();
  });

  // Fire due reminders / scheduled messages / follow-ups — every minute
  if (bot) {
    cron.schedule('* * * * *', async () => {
      try {
        const { fireDueTasks } = require('../services/scheduler');
        await fireDueTasks(bot);
      } catch (e) {
        console.error('fireDueTasks cron error:', e);
      }
    });

    // Morning briefing — 7 AM EAT (04:00 UTC)
    cron.schedule('0 4 * * *', async () => {
      try {
        const { sendBriefingsToAll } = require('../services/scheduler');
        const n = await sendBriefingsToAll(bot);
        console.log(`☀️ Morning briefings sent: ${n}`);
      } catch (e) {
        console.error('morning briefing cron error:', e);
      }
    });
  }

  console.log('⏰ Cron jobs scheduled');
}

module.exports = { setupCronJobs };
