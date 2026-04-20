require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { startServer, bot } = require('./server');
const { setupCronJobs } = require('./src/cron');

async function main() {
  console.log('🪞 MiniMe Bot starting...');
  const port = process.env.PORT || 3000;
  startServer(port);
  setupCronJobs(bot);
  console.log(`🪞 MiniMe Bot running on port ${port}`);
}

main().catch(console.error);
