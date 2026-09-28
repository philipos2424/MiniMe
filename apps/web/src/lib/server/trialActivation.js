/**
 * Transactional "you're activated" DM — sent the moment a business transitions
 * into subscription_status='active', whether that happens one at a time (admin
 * businesses/[id] PATCH), in bulk (bulk-activate-trials), or off a verified
 * payment.
 *
 * Sent from the PLATFORM bot (TELEGRAM_BOT_TOKEN = @MiniMeAgentBot), not the
 * shop's own bot. Every owner reached us through @MiniMeAgentBot during
 * onboarding, so that chat is guaranteed to exist and to have been accepted —
 * a shop that never linked its own bot would simply never receive this
 * otherwise.
 *
 * Uses the flood-safe low-level sender (not the notify-owners broadcast path,
 * which has a platform-wide rate limit meant for one-off announcements —
 * wrong fit for a transactional confirmation that must fire immediately,
 * possibly for many businesses at once during a bulk activation).
 */
import { sendTelegramMessage } from './telegram-send.mjs';
import { getPrimaryAdminId } from './admin';

function ownerChatId(business) {
  return business.owner_private_chat_id || business.owner_telegram_id || null;
}

/**
 * Telegram rejects the WHOLE message with a 400 when Markdown doesn't parse,
 * so an owner whose shop is called "M*A*S*H" or "deal_maker" would silently
 * never receive this. Shop names are merchant-controlled free text and are the
 * only interpolated value here.
 */
function mdEscape(s) {
  return String(s || '').replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
}

/**
 * The welcome. Two jobs: make the moment feel like something, and tell an owner
 * what they can actually do now — most have only ever seen MiniMe answer a
 * customer, and have no idea the rest exists.
 *
 * Deliberately concrete rather than a feature list: every line is phrased as a
 * thing that happens in their shop, because "knowledge base" means nothing to a
 * boutique owner in Addis and "it remembers what you told it" does.
 */
function activationMessage({ name, planTier, expiresAt, paid }) {
  const plan = planTier === 'pro' ? 'Pro' : (planTier || 'Pro');
  const until = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    : null;

  const opening = paid
    ? `Thank you — your payment is confirmed and *${mdEscape(name)}* is on *${plan}*.`
    : `*${mdEscape(name)}* is now on *${plan}*, on us${until ? '' : ' for now'}.`;

  return (
    `🎉 *Welcome to MiniMe ${plan}!*\n\n` +
    `${opening}${until ? `\nActive until *${mdEscape(until)}*.` : ''}\n\n` +
    `Here's what I can do for you now:\n\n` +
    `💬 *I answer your customers myself* — in Amharic or English, in your voice, ` +
    `at 11pm and on Sundays. You don't have to be there.\n\n` +
    `📦 *I know your shop* — prices, sizes, what's in stock, delivery, ` +
    `how long things take. Tell me once and I remember.\n\n` +
    `🛒 *I take orders* — I catch what they want, confirm the total, and ` +
    `pass it to you ready to fulfil.\n\n` +
    `✏️ *I learn from you* — correct one of my replies and I'll answer that ` +
    `way next time, without being asked twice.\n\n` +
    `📢 *I can reach every customer at once* — a sale, a restock, a new arrival.\n\n` +
    `Try me: send me *"what do you sell?"* the way a customer would, and watch what I say.\n\n` +
    `Anything confusing, just reply here. 🙌`
  );
}

/**
 * Fire-and-forget-safe (still awaited by the caller) — never throws, returns
 * { ok, blocked } so callers can log/ignore without extra try/catch noise.
 */
export async function sendTrialActivatedMessage(business, { planTier, expiresAt, paid = false } = {}) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = ownerChatId(business);
  if (!token || !chatId) return { ok: false, blocked: false, skipped: true };

  try {
    const result = await sendTelegramMessage(token, {
      chat_id: chatId,
      text: activationMessage({ name: business.name, planTier, expiresAt, paid }),
      parse_mode: 'Markdown',
    });
    return result;
  } catch (e) {
    return { ok: false, blocked: false, description: e.message };
  }
}

/**
 * Tell the platform admin that Pro was just granted, and by what.
 *
 * Every path that grants Pro used to be silent except the proof upload, so a
 * grant from the webhook or the admin "Activate" button left no trace anywhere
 * the owner would see it — which is how ~600 accounts ended up on Pro with
 * nobody noticing. `source` is the important field: it says WHICH path fired,
 * so an unexpected grant is attributable instead of a mystery.
 *
 * NOT called per-business during bulk activation — 600 DMs would bury the
 * admin. That path audits a single row with its count instead.
 */
export async function notifyAdminActivation({ business, source, planTier, expiresAt, paid = false, detail }) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const adminId = getPrimaryAdminId();
  if (!token || !adminId) return { ok: false, skipped: true };

  const until = expiresAt
    ? new Date(expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : 'no expiry set';

  const text =
    `${paid ? '💰' : '🎁'} *Pro ${paid ? 'PAID' : 'granted (unpaid)'}*\n\n` +
    `*${mdEscape(business.name || 'Unknown')}*\n` +
    `Plan: ${mdEscape(planTier || 'pro')} · Until: ${mdEscape(until)}\n` +
    `Source: \`${mdEscape(source)}\`` +
    (detail ? `\n${mdEscape(detail)}` : '');

  try {
    return await sendTelegramMessage(token, { chat_id: adminId, text, parse_mode: 'Markdown' });
  } catch (e) {
    return { ok: false, description: e.message };
  }
}
