/**
 * Secretary knowing who people are, and closing the loop with the owner
 * (pure, no I/O).
 *
 * Nov 2026, last 30 days: 379 Secretary chats; 75 "unknown". The owner sorted
 * none of them — the /who list was never opened. The unknowns are mostly new
 * or short chats (3 messages on average) and many are spam (betting groups,
 * crypto, "PDF converter" bots). So:
 *   1. Read the obvious signals first (a contact saved as "Mom", "my love";
 *      someone asking prices; a betting-group link) — no AI, no question.
 *   2. Don't let a later, thinner guess erase a good earlier one.
 *   3. When it's still unclear after a real exchange, ask the owner about ONE
 *      person, right then, with one tap — a few times a day at most, never
 *      at night, never about spam.
 *   4. In the evening, one short recap: how many people I answered, who is
 *      waiting on you (things I said I'd check) — with a button to answer
 *      each one, which I send from your account.
 */

const lower = (s) => String(s || '').toLowerCase().normalize('NFKC');

// Contact names that say who someone is. Matched on whole words in the name the
// owner saved / the profile name / the owner's nicknames for them.
const FAMILY_NAME = /(^|[^\p{L}])(mom|mum|mama|mommy|mother|emaye|emama|ema|enat|dad|daddy|baba|babi|abba|abiye|ababa|father|sis|sister|ehite|brother|wendme|wondme|wendmu|grandma|grandpa|ayat|aunt|auntie|uncle|cousin|wife|husband|hubby|wifey|my love|love|babe|baby|honey|habibi|habibti|fiance|fiancee|ፍቅሬ|እማ|እማዬ|እናቴ|አባ|አባዬ|አባቴ|እህቴ|ወንድሜ|አያቴ|ባለቤቴ|ሚስቴ|ባሌ|ውዴ)([^\p{L}]|$)/u;
const HEART_NAME = /[❤️💕💖💗💘💞💓♥️😍🥰]/u;
const FRIEND_NAME = /(^|[^\p{L}])(bro|bruh|bestie|bff|buddy|homie|mate|ጓደኛ|ጓዴ)([^\p{L}]|$)/u;

const CUSTOMER_TEXT = /\b(how much|price|prices|cost|do you have|available|in stock|order|deliver|delivery|discount|wholesale|sample|catalog|catalogue|menu)\b|ስንት ነው|ዋጋ|አለ\?|አላችሁ|ትልካላችሁ|ዴሊቨሪ/i;
const SPAM_TEXT = /(correct score|fixed match|betting|bet ?slip|odds|casino|jackpot|airdrop|crypto signal|forex|investment plan|double your|earn \$?\d+ (per|a) day|join (our|my) (group|channel)|free (vip|signals?)|click (the )?link|t\.me\/\+|t\.me\/joinchat|bit\.ly)/i;
const BOT_NAME = /(support|official|bot|converter|download|promo|giveaway|vip|signals?)\b/i;

/**
 * Quick read from names and their messages. Returns
 * { relationship, confidence, spam, why } or null when nothing is clear.
 * names: the saved/profile name and any nicknames the owner uses.
 */
export function quickRelationship({ names = [], inbound = [] } = {}) {
  const ns = names.map(lower).filter(Boolean);
  const text = inbound.map(t => String(t || '')).join('\n');
  const spamHits = (text.match(new RegExp(SPAM_TEXT.source, 'gi')) || []).length;
  if (spamHits >= 1 && (spamHits >= 2 || ns.some(n => BOT_NAME.test(n)) || inbound.length <= 2)) {
    return { relationship: 'unknown', spam: true, confidence: 0.85, why: 'promotion/spam' };
  }
  if (ns.some(n => FAMILY_NAME.test(n)) || names.some(n => HEART_NAME.test(String(n || '')))) {
    return { relationship: 'family', spam: false, confidence: 0.85, why: 'name' };
  }
  if (ns.some(n => FRIEND_NAME.test(n))) return { relationship: 'friend', spam: false, confidence: 0.7, why: 'name' };
  const asks = inbound.filter(t => CUSTOMER_TEXT.test(String(t || ''))).length;
  if (asks >= 1 && asks >= Math.ceil(inbound.length / 3)) return { relationship: 'customer', spam: false, confidence: 0.7, why: 'asks about products' };
  return null;
}

export const RELATIONSHIPS = ['family', 'friend', 'colleague', 'customer', 'unknown'];

/**
 * Pick the relationship to keep. The owner's answer always stands; a clear
 * name signal beats the AI; a confident AI guess beats an old one; a vague
 * new guess never erases a known one.
 */
export function mergeRelationship(prev = {}, ai = {}, quick = null) {
  if (prev.owner_set && prev.relationship) return { relationship: prev.relationship, source: 'owner' };
  if (quick && quick.why === 'name' && quick.confidence >= 0.8) return { relationship: quick.relationship, source: 'name' };
  const aiRel = RELATIONSHIPS.includes(ai.relationship) ? ai.relationship : 'unknown';
  const aiConf = Number.isFinite(Number(ai.confidence)) ? Number(ai.confidence) : 0.6;
  if (aiRel !== 'unknown' && aiConf >= 0.55) return { relationship: aiRel, source: 'chat' };
  if (quick && quick.relationship !== 'unknown') return { relationship: quick.relationship, source: quick.why };
  if (prev.relationship && prev.relationship !== 'unknown') return { relationship: prev.relationship, source: prev.relationship_source || 'chat' };
  return { relationship: 'unknown', source: null };
}

/** Hour in Addis Ababa (UTC+3, no DST). */
export const addisHour = (now = Date.now()) => new Date(now + 3 * 3600000).getUTCHours();
/** Addis calendar date, YYYY-MM-DD. */
export const addisDate = (now = Date.now()) => new Date(now + 3 * 3600000).toISOString().slice(0, 10);

export const MAX_ASKS_PER_DAY = 3;

/**
 * Ask the owner about this one person now?
 * cp: contact_profile; inboundCount: messages they sent; asks: prefs.who_asks
 */
export function shouldAskWho(cp, { inboundCount = 0, asks = null, now = Date.now(), isPersonal = false } = {}) {
  if (!cp || cp.owner_set || cp.spam || cp.asked_at || isPersonal) return false;
  if (cp.relationship && cp.relationship !== 'unknown') return false;
  if (inboundCount < 2) return false;
  const h = addisHour(now);
  if (h < 8 || h >= 21) return false;
  const today = addisDate(now);
  const n = asks?.date === today ? Number(asks.n) || 0 : 0;
  return n < MAX_ASKS_PER_DAY;
}

export function nextAsks(asks, now = Date.now()) {
  const today = addisDate(now);
  return { date: today, n: (asks?.date === today ? Number(asks.n) || 0 : 0) + 1 };
}

export function askWhoText({ name, lastMessage, notes }) {
  const lines = [`👤 *Who is ${name || 'this person'}?*`, ''];
  if (lastMessage) lines.push(`They wrote: _"${String(lastMessage).replace(/[_*`[\]]/g, '').slice(0, 140)}"_`);
  if (notes) lines.push(`What I know: ${String(notes).replace(/[_*`[\]]/g, '').slice(0, 140)}`);
  lines.push('', "One tap and I'll talk to them the right way — warm with family and friends, helpful with customers, or not at all.");
  return lines.join('\n');
}

// ── Owner answers through Secretary ──────────────────────────────────────────

export const RELAY_TTL_MS = 30 * 60 * 1000;

export const relayCallback = (conversationId) => `sra_${conversationId}`;
export function parseRelay(data) {
  const m = String(data || '').match(/^sra_([0-9a-f-]{36})$/);
  return m ? m[1] : null;
}

/** The owner is typing an answer for someone (set by an "Answer" button). */
export function activeRelay(prefs, now = Date.now()) {
  const r = prefs?.secretary_relay;
  if (!r?.conversation_id || !r.at) return null;
  return now - Date.parse(r.at) > RELAY_TTL_MS ? null : r;
}

export const relayPromptText = (name) =>
  `✍️ *What should I tell ${name}?*\n\nType your answer — I'll send it to them from your account, as you.\n\n_/cancel to stop._`;

export function relaySentText(name, ok, reason = '') {
  if (ok) return `✅ Sent to *${name}* as you.`;
  if (/24|window|can't be sent|not allowed|forbidden|chat not found|peer/i.test(reason)) {
    return `⚠️ Telegram wouldn't let me send that to *${name}* — I can only reply in chats they messaged in the last day or so. Please send it yourself.`;
  }
  return `⚠️ I couldn't send that to *${name}*${reason ? ` (${String(reason).slice(0, 80)})` : ''}. Please send it yourself.`;
}

// ── Evening recap ────────────────────────────────────────────────────────────

/**
 * stats: { answered, people, waiting: [{ conversationId, name, asked }], unsure }
 * Returns null when there's nothing worth a message.
 */
export function recapText(stats, { ownerFirst = '' } = {}) {
  const { answered = 0, waiting = [], unsure = 0 } = stats || {};
  if (!answered && !waiting.length) return null;
  const clean = (s) => String(s || '').replace(/[_*`[\]]/g, '');
  const lines = [`🌙 *${ownerFirst ? `${clean(ownerFirst)}, here's` : "Here's"} your day on Telegram*`, ''];
  if (answered) lines.push(`I answered *${answered} ${answered === 1 ? 'person' : 'people'}* for you today.`);
  if (waiting.length) {
    lines.push('', `*${waiting.length === 1 ? '1 person is' : `${waiting.length} people are`} waiting for you* — I said I'd check:`);
    waiting.slice(0, 5).forEach((w, i) => lines.push(`${i + 1}. *${clean(w.name)}* — _"${clean(w.asked || '…').slice(0, 90)}"_`));
    lines.push('', "Tap a name to answer — I'll send it as you.");
  } else if (answered) {
    lines.push('Nobody is waiting on you. 👌');
  }
  if (unsure) lines.push('', `👥 I'm not sure who ${unsure === 1 ? '1 person is' : `${unsure} people are`}.`);
  return lines.join('\n');
}

export function recapKeyboard(stats) {
  const rows = (stats?.waiting || []).slice(0, 5).map(w => [{ text: `✍️ Answer ${String(w.name).slice(0, 28)}`, callback_data: relayCallback(w.conversationId) }]);
  if (stats?.unsure) rows.push([{ text: `👥 Sort ${stats.unsure === 1 ? 'them' : `${Math.min(stats.unsure, 6)} people`}`, callback_data: 'who_list' }]);
  rows.push([{ text: '🔕 No evening recap', callback_data: 'srec_off' }]);
  return { inline_keyboard: rows };
}

/** Recap is on unless the owner turned it off; only for owners with Secretary connected. */
export function recapWanted(business) {
  if (!business?.telegram_biz_conn_id) return false;
  return business.notification_prefs?.secretary_recap?.enabled !== false;
}
