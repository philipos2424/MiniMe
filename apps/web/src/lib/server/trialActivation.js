/**
 * Transactional "your trial is now active" DM — sent the moment a business
 * transitions into subscription_status='active', whether that happens one at
 * a time (admin businesses/[id] PATCH) or in bulk (bulk-activate-trials).
 *
 * Uses the flood-safe low-level sender (not the notify-owners broadcast path,
 * which has a platform-wide rate limit meant for one-off announcements —
 * wrong fit for a transactional confirmation that must fire immediately,
 * possibly for many businesses at once during a bulk activation).
 */
import { sendTelegramMessage } from './telegram-send.mjs';

function ownerChatId(business) {
  return business.owner_private_chat_id || business.owner_telegram_id || null;
}

function activationMessage({ name, planTier, expiresAt }) {
  const plan = planTier === 'pro' ? 'Pro' : (planTier || 'Pro');
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : null;
  return (
    `🎉 *Great news — ${name} is activated!*\n\n` +
    `You're now on the *${plan} plan*, free of charge${until ? ` until *${until}*` : ''}.\n\n` +
    `Everything is unlocked: unlimited AI replies, the full dashboard, and priority support.\n\n` +
    `No action needed from you — just keep chatting with your customers. If you have any questions, just reply here. 🙌`
  );
}

/**
 * Fire-and-forget-safe (still awaited by the caller) — never throws, returns
 * { ok, blocked } so callers can log/ignore without extra try/catch noise.
 */
export async function sendTrialActivatedMessage(business, { planTier, expiresAt } = {}) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = ownerChatId(business);
  if (!token || !chatId) return { ok: false, blocked: false, skipped: true };

  try {
    const result = await sendTelegramMessage(token, {
      chat_id: chatId,
      text: activationMessage({ name: business.name, planTier, expiresAt }),
      parse_mode: 'Markdown',
    });
    return result;
  } catch (e) {
    return { ok: false, blocked: false, description: e.message };
  }
}
