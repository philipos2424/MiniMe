/**
 * Multi-tenant bot factory.
 *
 * Creates a per-tenant TelegramBot instance (no polling, no webhook install —
 * this is used to SEND messages and process already-received updates).
 * The webhook is installed once during linking, not here.
 *
 * Instances are cached by token so we don't rebuild them on every update.
 */
const TelegramBot = require('node-telegram-bot-api');

const cache = new Map();

function getBotForToken(token) {
  if (!token) throw new Error('getBotForToken: missing token');
  if (cache.has(token)) return cache.get(token);
  const bot = new TelegramBot(token, { polling: false });
  cache.set(token, bot);
  return bot;
}

/**
 * Dispatch a raw Telegram update object through the existing handler stack.
 * `update` is the JSON Telegram POSTs to the webhook.
 */
async function dispatchUpdate(bot, update) {
  const { handleMessage } = require('./handlers/message');
  const { handleCommand } = require('./handlers/command');
  const { handleCallbackQuery } = require('./handlers/callback');

  if (update.message) {
    const msg = update.message;
    if (msg.text && msg.text.startsWith('/')) {
      await handleCommand(bot, msg);
    } else {
      await handleMessage(bot, msg);
    }
    return;
  }
  if (update.edited_message) {
    // Treat edits as new messages for now
    await handleMessage(bot, update.edited_message);
    return;
  }
  if (update.callback_query) {
    await handleCallbackQuery(bot, update.callback_query);
    return;
  }
  // Unsupported update types (channel_post, inline_query, etc.) are ignored silently
}

module.exports = { getBotForToken, dispatchUpdate };
