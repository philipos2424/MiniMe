/**
 * Mirrors apps/bot/src/copy.js buildCapabilitiesText() (CJS, for the bot
 * process). apps/web can't import across the monorepo boundary here — see
 * packages/shared/plan.js's note on mirroring for Vercel bundling — so this
 * is duplicated on purpose. Keep both in sync if you change the copy.
 *
 * Sent once, right when onboarding actually finishes (complete-shared /
 * bot/link), since that's the real "I'm live" moment for a new owner —
 * not every time they retype /start.
 */
export function buildCapabilitiesText() {
  return `✨ Here's what I take off your plate:\n\n` +
    `💬 Answer customers instantly, in your voice — day or night\n` +
    `👋 Follow up automatically with people who went quiet\n` +
    `🧠 Remember every customer and flag your VIPs\n` +
    `📥 Watch your inventory and warn you before you run out\n` +
    `🏭 Handle suppliers — track them and draft reorders when stock is low\n` +
    `⏰ Set reminders and follow-ups so nothing slips\n` +
    `☀️ Send you a morning briefing on what needs attention\n` +
    `🧭 Advise you on who to reply to first and what to say\n` +
    `📈 Track your sales, revenue, and growth week over week\n\n` +
    `Type /help anytime for the full list of commands.`;
}
