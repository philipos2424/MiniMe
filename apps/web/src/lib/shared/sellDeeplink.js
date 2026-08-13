/**
 * Shared "sell on MiniMe" deep-link builder.
 *
 * Every surface that hands a prospective seller off to @MiniMeAgentBot
 * (MiniMe Search's /start button, its /sell command, the Market's "Sell on
 * MiniMe" link, and the in-results nudge) must tag itself with a distinct
 * source so the recruiting funnel (sellFunnel.mjs) can tell which surface
 * actually converts, instead of seeing one undifferentiated tap.
 *
 * Framework-free — imported from server code (searchBot.js) and from a
 * 'use client' file (market/lib.js), so no server-only imports here.
 */
export function buildSellDeeplink(source) {
  return `https://t.me/MiniMeAgentBot?start=sell_${source}`;
}
