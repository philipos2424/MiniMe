const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
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
  app.use(express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }));

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
      const secret = process.env.CHAPA_WEBHOOK_SECRET;
      const signature = req.headers['x-chapa-signature'] || req.headers['chapa-signature'];

      if (secret && signature) {
        const hash = crypto.createHmac('sha256', secret)
          .update(req.rawBody || JSON.stringify(req.body))
          .digest('hex');

        // Constant-time comparison to prevent timing attacks
        const signatureBuf = Buffer.from(signature);
        const hashBuf = Buffer.from(hash);

        if (signatureBuf.length !== hashBuf.length || !crypto.timingSafeEqual(signatureBuf, hashBuf)) {
          console.warn('[payment webhook] signature verification failed');
          return res.sendStatus(401);
        }
      } else if (process.env.NODE_ENV === 'production') {
        console.warn('[payment webhook] missing secret or signature in production');
        return res.sendStatus(401);
      }

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
