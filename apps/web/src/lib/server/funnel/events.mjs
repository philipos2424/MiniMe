/**
 * Funnel definitions — the ONLY place these are defined (pricing & funnel
 * spec §1). Pure and dependency-free so it runs under plain `node --test`.
 *
 * "Conversation" is defined here once: one end customer's thread with one
 * shop inside a 24-hour window. Plan limits (spec §3) must import it from
 * here rather than re-deriving it.
 */

export const FUNNEL_EVENTS = [
  'registered', 'onboarding_completed', 'first_customer_message', 'activated',
  'trial_started', 'payment_submitted', 'payment_confirmed',
  'subscription_renewed', 'churned',
];

/** The steps shown as a funnel, in order. */
export const FUNNEL_STEPS = [
  'registered', 'onboarding_completed', 'first_customer_message', 'activated',
  'payment_submitted', 'payment_confirmed',
];

export const CONVERSATION_WINDOW_MS = 24 * 3600 * 1000;
/** Activated = this many real customer conversations ... */
export const ACTIVATION_CONVERSATIONS = 3;
/** ... within this many days of finishing onboarding. */
export const ACTIVATION_WINDOW_DAYS = 7;

const DAY_MS = 86400000;
const ms = v => new Date(v).getTime();

/** Test/demo shops. Only an explicit true counts — null is a real shop. */
export function isInternal(business) {
  return business?.is_internal === true;
}

/**
 * Is this customer row a real end customer of the shop — not the owner
 * testing their own bot, not a sub-admin, not a platform admin?
 * A customer without a telegram id (WhatsApp/Instagram) is real.
 */
export function isRealCustomer(business, customer, adminIds = []) {
  if (!business || isInternal(business)) return false;
  const tgId = customer?.telegram_id;
  if (tgId == null) return true;
  const id = String(tgId);
  if (business.owner_telegram_id != null && String(business.owner_telegram_id) === id) return false;
  if ((business.sub_admin_telegram_ids || []).map(String).includes(id)) return false;
  if ((adminIds || []).map(String).includes(id)) return false;
  return true;
}

/**
 * Inbound messages from real end customers of external shops, oldest first.
 * A message whose customer row cannot be found is kept: the owner-test case
 * needs a customer row to detect, and dropping unknowns would undercount.
 */
export function realInboundMessages({ businesses = [], customers = [], messages = [], adminIds = [] }) {
  const bizById = new Map(businesses.map(b => [b.id, b]));
  const custById = new Map(customers.map(c => [c.id, c]));
  return messages
    .filter(m => {
      if (m.direction && m.direction !== 'inbound') return false;
      const b = bizById.get(m.business_id);
      if (!b || isInternal(b)) return false;
      if (!m.customer_id) return true;
      const c = custById.get(m.customer_id);
      return c ? isRealCustomer(b, c, adminIds) : true;
    })
    .sort((a, b) => ms(a.created_at) - ms(b.created_at));
}

/**
 * Group inbound messages into conversations. A conversation opens with a
 * customer's message and covers the next 24 hours; a message after that
 * opens a new one. Messages with neither customer_id nor conversation_id
 * cannot be attributed and are skipped.
 *
 * @returns {{business_id, customer_key, started_at, messages}[]} oldest first
 */
export function conversationsOf(messages) {
  const sorted = [...(messages || [])].sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const open = new Map();
  const out = [];
  for (const m of sorted) {
    const who = m.customer_id || m.conversation_id;
    if (!m.business_id || !who) continue;
    const key = `${m.business_id}|${who}`;
    const cur = open.get(key);
    if (cur && ms(m.created_at) - ms(cur.started_at) < CONVERSATION_WINDOW_MS) {
      cur.messages++;
      continue;
    }
    const conv = { business_id: m.business_id, customer_key: String(who), started_at: m.created_at, messages: 1 };
    open.set(key, conv);
    out.push(conv);
  }
  return out;
}

/**
 * When did a shop activate? The start of its Nth real conversation inside
 * the activation window, or null.
 *
 * @param {string} onboardedAt  ISO time onboarding finished
 * @param {object[]} realMessages  that shop's real inbound messages
 */
export function activationTime(onboardedAt, realMessages) {
  const from = ms(onboardedAt);
  if (Number.isNaN(from)) return null;
  const to = from + ACTIVATION_WINDOW_DAYS * DAY_MS;
  const inWindow = (realMessages || []).filter(m => {
    const t = ms(m.created_at);
    return t >= from && t <= to;
  });
  const convs = conversationsOf(inWindow);
  return convs.length >= ACTIVATION_CONVERSATIONS ? convs[ACTIVATION_CONVERSATIONS - 1].started_at : null;
}
