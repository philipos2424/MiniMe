/**
 * The exit question, asked of people who can actually answer it.
 *
 * We have five exit reasons on record for the whole platform. Not because the
 * machinery is missing — reengage/copy.mjs sends chips, agent-bot/webhook
 * records the tap, the admin dashboard and the weekly digest read it, and all
 * of it works. It is because the question is only ever put to people who
 * abandoned SIGNUP. Someone who never finished creating a shop can tell you the
 * form was confusing; they cannot tell you why a working shop went quiet.
 *
 * 72 shops had real customer traffic in June. 15 still had any in August. Those
 * 57 are the only people who know why, and not one has been asked.
 *
 * Migration 051 is what makes asking possible at all: until
 * last_shop_activity_date existed there was no way to identify a shop that had
 * gone quiet, because last_active_date was NULL for 732 shops that had been
 * busy for weeks.
 *
 * Most of what follows is restraint. This message sells nothing and asks for
 * nothing back but one tap.
 */

export const CHURN_EXIT_PREFIX = 'churn_exit:';

// Deliberately different from reengage's EXIT_BUTTONS ("too complicated", "no
// time"), which are about a setup that never finished. These are the answers
// available to someone whose shop ran and then stopped. Mixing the two would
// make both datasets unreadable.
export const CHURN_EXIT_REASONS = {
  no_customers:    'No customers came',
  i_reply_myself:  'I answer them myself',
  made_mistakes:   'It got things wrong',
  too_expensive:   'Too expensive',
  shop_closed:     'Shop closed or changed',
};

// A shop has to have been quiet long enough that "went quiet" is true, and
// recently enough that the owner remembers why. activityTier() buckets at 30
// and 90; 21 sits just inside its 'active' window on purpose — a shop three
// weeks silent has stopped, whatever the bucket says.
const QUIET_MIN_DAYS = 21;
const QUIET_MAX_DAYS = 120;

const DAY_MS = 86_400_000;

/**
 * Should we ask this shop why it went quiet?
 *
 * @param {object} shop - row with last_shop_activity_date, owner_private_chat_id,
 *   notification_prefs
 * @param {{now?: number, askedAt?: string|null}} opts
 *   `askedAt` is when we last put this question to them, if ever.
 * @returns {{ask: boolean, reason: string}} `reason` names the decision either way.
 */
export function churnExitEligibility(shop, { now = Date.now(), askedAt = null } = {}) {
  // Asked once, ever. An exit question repeated is not a follow-up, it is
  // nagging someone who has already left.
  if (askedAt) return { ask: false, reason: 'already_asked' };

  if (!shop?.owner_private_chat_id) return { ask: false, reason: 'unreachable' };
  if (shop?.notification_prefs?.owner_nudges?.opted_out === true) {
    return { ask: false, reason: 'opted_out' };
  }

  // No traffic ever means no experience to report. reengage already owns the
  // signup-abandonment question for these shops.
  const last = shop?.last_shop_activity_date;
  if (!last) return { ask: false, reason: 'never_active' };
  const lastMs = Date.parse(`${String(last).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(lastMs)) return { ask: false, reason: 'never_active' };

  const quietDays = Math.floor((now - lastMs) / DAY_MS);
  if (quietDays < QUIET_MIN_DAYS) return { ask: false, reason: 'still_active' };
  if (quietDays > QUIET_MAX_DAYS) return { ask: false, reason: 'too_long_ago' };

  return { ask: true, reason: 'quiet' };
}

const firstNameOf = shop =>
  String(shop?.owner_name || '').trim().split(/\s+/)[0] || 'Hi';

/**
 * The message. One question, five taps, no pitch.
 *
 * Bilingual because every other owner-facing nudge is — an exit question in
 * English only collects English speakers' reasons, which is a different survey
 * than the one we think we are running.
 *
 * `buttons` uses the same {text, action} shape reengage/send.js already maps
 * onto an inline_keyboard.
 */
export function churnExitMessage(shop) {
  const first = firstNameOf(shop);
  const name = shop?.name || 'your shop';

  return {
    text:
      `${first}, one question and I'll leave it there 🙏\n\n` +
      `*${name}* was busy on MiniMe for a while, and then it went quiet. ` +
      `I'd genuinely like to know what happened — whatever the answer is, it ` +
      `helps me stop it happening to the next shop.\n\n` +
      `One tap. Nothing changes on your side either way.\n\n` +
      `ሱቅዎ ጸጥ ብሏል። ለምን እንደሆነ ማወቅ እፈልጋለሁ — አንድ ንክኪ ብቻ።`,
    buttons: [
      [{ text: '🙍 No customers came',     action: `${CHURN_EXIT_PREFIX}no_customers` },
       { text: '💬 I answer them myself',  action: `${CHURN_EXIT_PREFIX}i_reply_myself` }],
      [{ text: '🤖 It got things wrong',   action: `${CHURN_EXIT_PREFIX}made_mistakes` },
       { text: '💸 Too expensive',         action: `${CHURN_EXIT_PREFIX}too_expensive` }],
      [{ text: '🏪 Shop closed or changed', action: `${CHURN_EXIT_PREFIX}shop_closed` }],
    ],
  };
}

/**
 * Read a tapped button back into a reason slug, or null.
 *
 * Refuses anything not on the list rather than storing free text as a reason —
 * an unrecognised slug in the column would quietly corrupt the one dataset this
 * whole exercise exists to build. Also refuses reengage's `reengage_exit:`
 * chips, which answer a different question and belong in a different bucket.
 */
export function parseChurnExitCallback(data) {
  if (typeof data !== 'string' || !data.startsWith(CHURN_EXIT_PREFIX)) return null;
  const slug = data.slice(CHURN_EXIT_PREFIX.length);
  return CHURN_EXIT_REASONS[slug] ? slug : null;
}
