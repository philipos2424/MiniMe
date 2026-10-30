/**
 * Customer-reply delivery failures (pure, no I/O).
 *
 * What the 60-day audit of failed outbound messages found:
 *   - ~60% were the daily follow-up cron "re-opening" chats that had been cold
 *     for weeks. Most were Secretary customers who only ever wrote to the
 *     owner's personal account: the bot can't DM them, and Telegram lets a
 *     business bot reply only in chats active in the last 24 hours. Each failure
 *     still flagged the chat "needs you / send failed", so the owner's inbox
 *     filled with alarms for messages nobody was waiting for.
 *   - ~40% were real replies on the fast path in Secretary chats. A failed fast
 *     send just marked the chat and returned: the owner was never shown the
 *     reply, unlike the main path, which falls back to an owner draft.
 *   - Telegram's reason was only in the logs, which keep one hour. It is now
 *     kept on the conversation (metadata.last_send_error).
 */

/** Telegram reply target that still sends if the customer's message is gone. */
export function replyParams(messageId) {
  return messageId ? { reply_parameters: { message_id: messageId, allow_sending_without_reply: true } } : {};
}

/** Short, storable record of why Telegram refused a send. */
export function sendErrorRecord(res, { path, at = new Date() } = {}) {
  return {
    at: at.toISOString(),
    path: path || 'unknown',
    code: res?.error_code ?? null,
    description: String(res?.description || (res ? 'not ok' : 'no response')).slice(0, 200),
  };
}

/**
 * Should the follow-up cron skip this customer? Yes when the chat is a
 * Secretary chat (the customer reached the owner's personal account): a
 * cold nudge there can't be delivered by the bot or the business connection.
 */
export function skipColdFollowUp({ isSecretaryChat }) {
  return !!isSecretaryChat;
}
