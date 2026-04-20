const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const { handleMessage } = require('./src/handlers/message');
const { handleCallbackQuery } = require('./src/handlers/callback');
const { handleCommand } = require('./src/handlers/command');

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: process.env.NODE_ENV !== 'production',
});

if (process.env.NODE_ENV === 'production' && process.env.TELEGRAM_WEBHOOK_URL) {
  bot.setWebHook(process.env.TELEGRAM_WEBHOOK_URL, {
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
  });
}

// Set the bot menu button to open the Mini App
if (process.env.WEB_URL) {
  bot.setChatMenuButton({
    menu_button: { type: 'web_app', text: 'Dashboard', web_app: { url: process.env.WEB_URL } },
  }).catch(e => console.warn('Could not set menu button:', e.message));
}

bot.on('message', (msg) => {
  if (msg.text && msg.text.startsWith('/')) {
    handleCommand(bot, msg);
  } else {
    handleMessage(bot, msg);
  }
});

bot.on('callback_query', (query) => handleCallbackQuery(bot, query));

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

function startServer(port) {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.get('/', (_req, res) => res.json({ status: 'MiniMe Bot running 🪞' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

  app.post('/api/webhook', (req, res) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
      return res.sendStatus(403);
    }
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });

  app.post('/api/payment/callback', async (req, res) => {
    try {
      const { handleChapaCallback } = require('./src/services/payment');
      await handleChapaCallback(req.body);
    } catch (e) {
      console.error('Payment callback error:', e);
    }
    res.sendStatus(200);
  });

  app.listen(port, () => console.log(`Express server on port ${port}`));
}

module.exports = { startServer, bot };
