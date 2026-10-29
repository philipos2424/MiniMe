/**
 * What the agent brain does after Telegram accepts or rejects a message it
 * sent to a customer. Pure, so it can be tested without Telegram or Supabase.
 */

// The tool result the model sees. A rejected send must come back ok:false —
// returning ok:true made the model believe the message landed and try again
// with a second message, which Telegram rejected the same way.
export function clientSendResult({ delivered, error, removed = [] }) {
  if (!delivered) {
    return {
      ok: false,
      error: `Telegram did not deliver this message (${error || 'unknown error'}). The customer has not seen it. Do not send it again; stop here.`,
    };
  }
  return removed.length
    ? { ok: true, note: `Sent without these links, which aren't real: ${removed.join(', ')}. Never invent links.` }
    : { ok: true };
}

// The conversation update after a send. A proactive message (a follow-up
// nobody asked for) that fails leaves the conversation as it was: the customer
// is not waiting on it, so it must not flag the chat for the owner or make a
// months-old lead look recent.
export function conversationPatchAfterSend({ delivered, proactive = false, nowIso }) {
  if (!delivered && proactive) return null;
  return {
    requires_owner: !delivered,
    last_ai_action: delivered ? 'auto_sent' : 'send_failed',
    last_message_at: nowIso,
  };
}
