/**
 * Single source of truth for Telegram webhook configuration.
 *
 * Why this file exists: the project broke (Secretary Mode + shared mode went
 * silent for everyone) because each webhook-registration path hand-rolled its
 * own `allowed_updates` list, and several of them omitted the business_*
 * update types. Telegram ONLY delivers update types present in
 * `allowed_updates`, so dropping `business_*` silently kills the Business API
 * (Secretary Mode). Centralising the list here means a single edit keeps every
 * registration path in sync forever.
 *
 * It also broke because a user linked one of MiniMe's OWN system bot tokens
 * (the shared @MiniMeAgentBot) as a "custom bot", which re-pointed the shared
 * webhook to a per-tenant path. The platform-bot guards below make that
 * impossible going forward.
 */

/**
 * The update types every MiniMe webhook subscribes to.
 *
 * MUST include the business_* types or Secretary Mode (Telegram Business API)
 * goes silent. This matches the proven-good set used by /api/agent-bot/setup.
 */
export const ALLOWED_UPDATES = Object.freeze([
  'message',
  'edited_message',
  'callback_query',
  'pre_checkout_query',
  'business_connection',
  'business_message',
  'edited_business_message',
  // Channel monitoring: when the bot is an admin of the owner's product
  // channel, Telegram delivers each new post as `channel_post`. `my_chat_member`
  // fires when the bot is added/removed as a channel admin (how we link the
  // channel to a business). Without these in the list Telegram sends neither.
  'channel_post',
  'edited_channel_post',
  'my_chat_member',
]);

/** Mutable copy — Telegram's API wants a plain array, not a frozen one. */
export function allowedUpdates() {
  return [...ALLOWED_UPDATES];
}

/**
 * Numeric bot ids of MiniMe's own system bots (shared agent bot + search bot).
 * Derived from the env tokens; the part before ':' is the bot's numeric id.
 */
export function platformBotIds() {
  return [process.env.TELEGRAM_BOT_TOKEN, process.env.SEARCH_BOT_TOKEN]
    .filter(Boolean)
    .map((t) => String(t).trim().split(':')[0])
    .filter(Boolean);
}

/**
 * True if `token` is one of MiniMe's own system bot tokens.
 * Used to reject linking the platform bot as a "custom bot" and to skip the
 * shared bot in per-tenant re-registration loops.
 */
export function isPlatformBotToken(token) {
  if (!token) return false;
  const id = String(token).trim().split(':')[0];
  if (!id) return false;
  return new Set(platformBotIds()).has(id);
}

/** True if `botId` is one of MiniMe's own system bots. */
export function isPlatformBotId(botId) {
  if (botId === null || botId === undefined || botId === '') return false;
  return platformBotIds().includes(String(botId).trim());
}
