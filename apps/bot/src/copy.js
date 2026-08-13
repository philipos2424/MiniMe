/**
 * Shared bot copy — kept in one place so /start, /help, and the mini-app
 * signup teaser never drift out of sync with each other.
 *
 * apps/web sends the onboarding-complete version of this message itself
 * (via its own bot token per business), so its capabilities text is mirrored
 * in apps/web/src/lib/server/botCopy.js. Keep the two in sync.
 */

function buildCapabilitiesText() {
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

function buildHelpText() {
  return `🪞 MiniMe Commands\n\n` +
    `🧠 /advisor <question> — Live client triage copilot (remembers context)\n` +
    `⏰ /remind <when> | <what> — Set a reminder\n` +
    `📅 /schedule — See upcoming reminders/follow-ups\n` +
    `📚 /docs — List uploaded knowledge-base documents\n` +
    `☀️ /briefing — Get the morning briefing now\n` +
    `📊 /status — Today's stats\n` +
    `🎚 /trust — Change AI trust level\n` +
    `🔴 /panic — Pause MiniMe (manual mode)\n` +
    `🟢 /resume — Resume MiniMe\n` +
    `📦 /products — List products\n` +
    `➕ /addproduct — Add a product\n` +
    `💰 /price — Update product price\n` +
    `📥 /stock — Check inventory\n` +
    `🏭 /suppliers — List suppliers\n` +
    `➕ /addsupplier — Add a local or international supplier\n` +
    `✏️ /editsupplier — Update supplier fields\n` +
    `🗑️ /deletesupplier — Archive a supplier\n` +
    `👥 /customers — Top customers\n` +
    `📈 /analytics — Weekly stats\n` +
    `🎙 /voice — Update voice profile\n` +
    `🔗 /link — Link a group chat to your business\n` +
    `💳 /upgrade — Unlock MiniMe Pro (1,999 ETB/month)\n` +
    `ℹ️ /help — This message\n\n` +
    `Open 📊 Dashboard anytime from the menu button below.`;
}

// Short teaser for the very first /start, before they've even signed up —
// keeps the mini-app CTA message from being just a bare "tap this button".
const SIGNUP_TEASER = 'I follow up with customers who go quiet, watch your stock, remind you what\'s pending, and draft every reply in your voice — day and night.';

module.exports = { buildCapabilitiesText, buildHelpText, SIGNUP_TEASER };
