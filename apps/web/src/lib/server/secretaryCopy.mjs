/**
 * What Secretary Mode tells the owner (pure, no I/O).
 *
 * Owners didn't understand Secretary because nothing told them what it was
 * doing. The connect message promised "I'll handle customer messages
 * automatically", but the default mode (ask_first) replies to NO new person
 * until the owner taps a Family / Friend / Customer card. Hundreds of people
 * were held that way, unanswered. The connect message also ignored whether
 * the owner allowed replies at all, and the settings page said "Not connected
 * yet?" to owners who were connected.
 */

/** One plain sentence: what happens when someone new writes, in this mode. */
export function modeExplainer(mode) {
  switch (mode) {
    case 'smart':
      return "When someone new writes, I reply on my own if it's clearly a customer. If I can't tell, I ask you first. Family and friends never get AI replies.";
    case 'auto':
      return 'When someone new writes, I work out who they are and reply as you. Family and friends I recognise never get AI replies.';
    case 'ghost':
      return "I never reply on your personal account. I only watch and give you a daily summary.";
    case 'ask_first':
    default:
      return "When someone new writes, I DON'T reply yet. I send you a card here: tap Customer and I answer them; tap Family or Friend and I stay out of it.";
  }
}

/** Telegram Bot API 9.0+ puts permissions in `rights`; older updates had `can_reply`. */
export function connectionCanReply(conn) {
  if (conn?.rights && typeof conn.rights.can_reply === 'boolean') return conn.rights.can_reply;
  if (typeof conn?.can_reply === 'boolean') return conn.can_reply;
  return true; // unknown → don't cry wolf
}

/** The message the owner gets right after connecting MiniMe to their account. */
export function connectedText({ mode = 'smart', canReply = true, capNote = '' } = {}) {
  const lines = ['✅ *MiniMe is connected to your Telegram account.*', ''];
  if (!canReply) {
    lines.push(
      "⚠️ *I can't reply yet.* Telegram is letting me read your chats but not answer them.",
      'Fix: Telegram Settings → Business → Chatbots → MiniMe → turn on *Reply to messages*.',
      '',
    );
  }
  lines.push(
    '*What happens now*',
    `• ${modeExplainer(mode)}`,
    '• People you already marked as customers get instant replies, in your voice.',
    '• You can always reply yourself — I step back in that chat and learn from you.',
    '',
    '⚠️ *One last step:* reply to this message — even "hi" — so Telegram lets me send you those cards and alerts here.',
    '',
    'Change how I handle new people: MiniMe → Settings → Secretary Mode.',
  );
  if (capNote) lines.push(capNote.trim());
  return lines.join('\n');
}

/** How many people are waiting for the owner to say who they are. */
export function waitingCount(pending, prune) {
  const live = typeof prune === 'function' ? prune(pending) : (pending || {});
  return Object.keys(live || {}).length;
}
