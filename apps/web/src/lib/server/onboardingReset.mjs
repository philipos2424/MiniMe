/**
 * Decides what POST /api/onboarding/reset may do to a business. Pure, so it
 * can be tested with node --test.
 *
 * Background: Settings → Sign out used to call the reset route, which set
 * onboarding_completed=false and nulled telegram_bot_username and bot_mode on
 * LIVE shops. A shared-mode shop then dropped out of MiniMe Search, the Market
 * and B2B reach (all filter on onboarding_completed=true), and the owner was
 * dropped into the signup wizard with 182 live conversations.
 *
 * Rules:
 *  - A shop that is live (has conversations, products, or a linked bot token)
 *    is only reset when the caller sends the explicit confirm phrase.
 *  - Even then, routing fields are never cleared: bot_mode and a linked bot's
 *    username stay, so customers keep reaching the shop. Only the wizard
 *    state and the onboarding flag are reopened.
 */
export const RESET_CONFIRM = 'start_setup_again';

export function isLiveShop(business, { conversationCount = 0, productCount = 0 } = {}) {
  if (!business) return false;
  return conversationCount > 0 || productCount > 0 || !!business.telegram_bot_token_enc;
}

/**
 * @returns {{ allowed: boolean, reason?: string, updates?: object }}
 */
export function resetDecision(business, { conversationCount = 0, productCount = 0, confirm } = {}) {
  if (!business) return { allowed: false, reason: 'no_business' };
  const live = isLiveShop(business, { conversationCount, productCount });
  if (live && confirm !== RESET_CONFIRM) {
    return { allowed: false, reason: 'live_shop_needs_confirm' };
  }
  // Reopen the wizard, but keep everything customers depend on.
  const updates = { onboarding_completed: false };
  if (!live) {
    // A shop nobody uses yet can start completely fresh.
    updates.telegram_bot_username = null;
    updates.bot_mode = null;
  }
  return { allowed: true, updates };
}
