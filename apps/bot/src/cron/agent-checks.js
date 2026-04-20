const { runAgentChecks: runChecks } = require('../services/agent');

async function runAgentChecks() {
  try {
    const bot = require('../../server').bot;
    await runChecks(bot);
  } catch (e) {
    console.error('agent-checks cron error:', e.message);
  }
}

module.exports = { runAgentChecks };
