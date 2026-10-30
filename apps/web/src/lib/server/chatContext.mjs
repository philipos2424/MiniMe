/**
 * What the reply model sees of the chat (pure, no I/O).
 *
 * MiniMe told people "you're repeating yourself" / "you already asked" 37
 * times in 16 chats (15 shops, mostly Secretary) in 45 days. Cause: the
 * customer's message is saved before the reply is drafted, so the "recent
 * history" already ends with it — and then every reply path (fast path,
 * draftReply, the brain) adds it AGAIN as the new message. The model saw the
 * same message twice in a row and, reasonably, said so.
 */

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Recent messages (oldest → newest) minus the trailing copy of the message
 * being answered right now. Only the LAST entry is dropped, and only when it
 * is inbound with the same text, so a customer who really did send something
 * twice still shows it once in history plus once as the new message.
 */
export function historyWithoutCurrent(recent, currentText) {
  const list = Array.isArray(recent) ? recent : [];
  const last = list[list.length - 1];
  if (last && last.direction === 'inbound' && norm(last.content) && norm(last.content) === norm(currentText)) {
    return list.slice(0, -1);
  }
  return list;
}

/** The bot's own most recent reply text (skips markers like "[sent 3 photos]"). */
export function lastOwnReply(recent) {
  const list = Array.isArray(recent) ? recent : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m?.direction !== 'outbound') continue;
    const c = String(m.content || '').trim();
    if (!c || /^\[.*\]$/.test(c)) continue;
    return c;
  }
  return '';
}

/**
 * Prompt lines that keep the reply moving forward. Added to every reply path.
 */
export function noRepeatRules(recent) {
  const last = lastOwnReply(recent);
  return [
    '## DON\'T REPEAT',
    '- Never tell anyone they are repeating themselves, already asked, or sent the same message. A message that looks repeated is usually a resend or a follow-up — just answer it.',
    '- If they ask again, they didn\'t get what they needed: answer differently, more specifically, or ask one short question about what\'s missing.',
    last ? `- Your last reply was: "${last.slice(0, 240).replace(/"/g, "'")}". Don't send that again or restate it; move the conversation forward.` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Was this same set of product photos already sent recently? The photo fast
 * path re-sent identical photo sets in 35 of 62 sends.
 */
export function photosAlreadySent(recent, marker, { lookback = 6 } = {}) {
  const list = (Array.isArray(recent) ? recent : []).slice(-lookback);
  return list.some(m => m?.direction === 'outbound' && String(m.content || '') === marker);
}

/** Only one "sorry, I'm having trouble" per conversation per window. */
export function fallbackRecentlySent(recent, { now = Date.now(), windowMs = 6 * 60 * 60 * 1000 } = {}) {
  return (Array.isArray(recent) ? recent : []).some(m =>
    m?.direction === 'outbound'
    && String(m.content || '').startsWith('[fallback')
    && now - new Date(m.created_at || 0).getTime() < windowMs);
}
