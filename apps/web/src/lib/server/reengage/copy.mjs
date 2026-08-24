/**
 * Bilingual re-engagement copy, one template per stage × variant.
 *
 * Rules that the tests pin, because breaking them costs trust:
 *   - Every interpolated number comes from a live query. A number that
 *     resolves to 0 drops its whole line — we never say "0 people".
 *   - English then Amharic in one message; no language detection, because the
 *     signal is sparse and a bilingual message is never unreadable.
 *   - No claims about bugs or fixes that did not happen.
 *
 * The Amharic here needs a native-speaker review pass before the first
 * production send — machine-adjacent translation goes subtly wrong in sales
 * copy exactly where tone matters.
 *
 * Pure — no I/O — so it is unit-testable by direct import.
 */

/** Escape the characters Telegram's legacy Markdown parser treats as syntax. */
export function escapeMd(text) {
  return String(text ?? '').replace(/([_*[\]`])/g, '\\$1');
}

const nameOr = (v, fallback) => (v ? escapeMd(v) : fallback);

/** Demand proof, or '' when there is no honest number to quote. */
function demandLine({ waiting, unanswered }) {
  if (waiting > 0) {
    return `*${waiting} ${waiting === 1 ? 'person' : 'people'}* searched MiniMe for a shop like yours and found nobody.\n\n` +
      `That's ${waiting} ${waiting === 1 ? 'customer' : 'customers'} with money ready and nowhere to spend it.`;
  }
  if (unanswered > 0) {
    return `In the last 90 days, *${unanswered} ${unanswered === 1 ? 'search' : 'searches'}* on MiniMe came up empty — real customers with no shop to send them to.`;
  }
  return '';
}

function demandLineAm({ waiting, unanswered }) {
  if (waiting > 0) return `*${waiting} ሰዎች* እንደ እርስዎ ያለ ሱቅ በMiniMe ላይ ፈልገው አላገኙም።`;
  if (unanswered > 0) return `ባለፉት 90 ቀናት *${unanswered} ፍለጋዎች* ያለ ውጤት ቀርተዋል።`;
  return '';
}

const OPEN_APP     = [[{ text: '📱 List my shop — 1 min', action: 'open_app' }]];
const TEACH_IT     = [[{ text: '🎓 Teach it — 2 min', action: 'open_teach' }]];
const TURN_IT_ON   = [[{ text: '⚡ Turn it on', action: 'open_connect' }]];
const SHARED_OR_TOKEN = [
  [{ text: '⚡ Skip it — go live now', action: 'go_shared' }],
  [{ text: '🔑 No, help me with the token', action: 'help_token' }],
];

const EXIT_BUTTONS = [
  [{ text: '😵 Too complicated', action: 'exit:too_complicated' },
   { text: '⏰ No time', action: 'exit:no_time' }],
  [{ text: '💸 Too expensive', action: 'exit:too_expensive' },
   { text: '👀 Just looking', action: 'exit:just_looking' }],
];

function exitMessage(facts) {
  const first = nameOr(facts.first, 'Hi');
  const shop = nameOr(facts.shop, 'your shop');
  return {
    text:
      `${first}, last message from me — I promise 🙏\n\n` +
      `You started setting up *${shop}* but didn't finish, and I'd genuinely like to know why. ` +
      `One tap, and it helps me fix it for the next person.\n\n` +
      `አንድ ንክኪ ብቻ — ለምን እንዳላጠናቀቁ ማወቅ እፈልጋለሁ።`,
    buttons: EXIT_BUTTONS,
  };
}

/** The "what are you missing" pitch — used by A1 and B1. */
function curious(facts, variant) {
  const first = nameOr(facts.first, 'there');
  const en = demandLine(facts);
  const am = demandLineAm(facts);

  if (variant === 'demand' && en) {
    return {
      text:
        `👋 Hi ${first} — ${en}\n\n` +
        `Listing your shop is free and takes about a minute.\n\n` +
        `${am}\nሱቅዎን መዘርዘር ነጻ ነው፣ አንድ ደቂቃ ብቻ ይወስዳል።`,
      buttons: OPEN_APP,
    };
  }

  // Payoff angle — also the fallback when there is no honest number to quote.
  return {
    text:
      `👋 Hi ${first} — you looked at MiniMe but never started.\n\n` +
      `Here's the whole thing in one line: *your customers message your Telegram, MiniMe answers them in your voice, 24/7, in Amharic and English.* You don't type anything.\n\n` +
      `ደንበኞችዎ ይጽፋሉ፣ MiniMe በእርስዎ አነጋገር ይመልስላቸዋል — 24/7፣ በአማርኛና በእንግሊዝኛ።`,
    buttons: OPEN_APP,
  };
}

/** Show a real generated reply — used by B2 and B3. */
function showReply(facts) {
  const first = nameOr(facts.first, 'there');
  const shop = nameOr(facts.shop, 'your shop');
  const q = escapeMd(facts.question || 'Do you deliver?');
  const draft = escapeMd(facts.draft || 'Yes — we deliver across Addis, same day.');
  return {
    text:
      `Hi ${first} 👋 — curious what *${shop}* would sound like on MiniMe?\n\n` +
      `A customer asks: _"${q}"_\n` +
      `${shop} replies: _"${draft}"_\n\n` +
      `MiniMe wrote that from nothing but your shop name. Two minutes of teaching and it'll know your prices, hours, and how you talk.\n\n` +
      `ይሄንን የጻፈው የሱቅዎን ስም ብቻ አይቶ ነው። ሁለት ደቂቃ ካስተማሩት ዋጋዎን፣ ሰዓትዎን እና አነጋገርዎን ይማራል።`,
    buttons: TEACH_IT,
  };
}

/** Trained and tested but never switched on — B4. */
function readyAndWaiting(facts) {
  const first = nameOr(facts.first, 'there');
  const shop = nameOr(facts.shop, 'your shop');
  const knows = facts.products > 0
    ? `It already knows ${facts.products} of your products` +
      (facts.factCount > 0 ? ` and ${facts.factCount} things about how *${shop}* works` : '') + '. '
    : '';
  return {
    text:
      `${first}, your assistant is *ready and waiting.*\n\n` +
      `${knows}It replies in your voice, in Amharic and English.\n\n` +
      `Right now it's answering nobody. One tap turns it on.\n\n` +
      `ረዳትዎ ተዘጋጅቷል። አሁን ግን ማንንም እያገለገለ አይደለም። አንድ ንክኪ ብቻ።`,
    buttons: TURN_IT_ON,
  };
}

/** Stalled at BotFather — B5. The escape hatch is the entire point. */
function botfatherEscape(facts) {
  const first = nameOr(facts.first, 'there');
  return {
    text:
      `${first} — you did all the hard work. You got stuck on the BotFather step, and honestly, that's the worst part of the whole setup.\n\n` +
      `*You can skip it entirely.* Tap below and MiniMe answers your customers through @MiniMeAgentBot instead. No token, no BotFather, works right now.\n\n` +
      `የBotFather ደረጃው ከባዱ ክፍል ነው — መዝለል ይችላሉ። MiniMe በ@MiniMeAgentBot በኩል ደንበኞችዎን ይመልሳል።`,
    buttons: SHARED_OR_TOKEN,
  };
}

const BY_STAGE = {
  A1: curious,
  B1: curious,
  B2: (facts) => showReply(facts),
  B3: (facts) => showReply(facts),
  B4: (facts) => readyAndWaiting(facts),
  B5: (facts) => botfatherEscape(facts),
};

/**
 * @param {{ stage: string, variant: 'demand'|'payoff', isFinal: boolean, facts: object }} input
 * @returns {{ text: string, buttons: Array<Array<{text: string, action: string}>> }}
 */
export function renderMessage({ stage, variant = 'payoff', isFinal = false, facts = {} }) {
  if (isFinal) return exitMessage(facts);
  const build = BY_STAGE[stage];
  if (!build) return exitMessage(facts); // unknown stage never sends silence
  return build(facts, variant);
}
