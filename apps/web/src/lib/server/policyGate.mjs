/**
 * Policy gate — stop MiniMe inventing shop policies.
 *
 * On 26–28 Oct 2026 the live bot answered "what's the warranty on the metal
 * card?" with "it doesn't come with a traditional warranty", and "what's your
 * refund policy if the card arrives damaged?" with "we don't have a
 * traditional refund policy, but…" — neither exists anywhere in the shop's
 * knowledge. The prompt already says "NEVER make up business facts"; the model
 * did it anyway. The existing knowledge-gap hand-off only fires when the model
 * itself admits it doesn't know.
 *
 * So this is deterministic and runs BEFORE the model: a customer asking about
 * a policy the owner never taught gets "let me confirm with <owner>", the gap
 * is logged and the owner is pinged with the question. Once the owner answers,
 * the answer is saved as an FAQ and the topic counts as covered from then on.
 *
 * Coverage only counts what the OWNER authored (rules, FAQ, business info,
 * product descriptions, taught / uploaded / corrected knowledge). Chunks
 * auto-learned from past chats don't count: that store produced the wrong
 * "jami.bio" answer and is unreviewed.
 */

// Each topic: how customers ask (EN + Amharic in both scripts) and the words
// that show the owner has said something about it.
export const POLICY_TOPICS = {
  warranty: {
    ask: [/\b(warrant(y|ies)|guarantee[sd]?|guaranty)\b/i, /(ዋስትና|ጋራንቲ|ዋራንቲ)/, /\b(wastina|wastna)\b/i],
    covered: [/warrant/i, /guarant/i, /ዋስትና/, /ጋራንቲ/],
  },
  returns: {
    ask: [/\b(refund|money back|return (it|them|policy|the)|can i return|exchange (it|policy)|replacement)\b/i, /(ተመላሽ|መመለስ እችላለሁ|ይመለሳል|ገንዘቤን|መቀየር እችላለሁ)/],
    covered: [/refund/i, /return/i, /exchange/i, /replace/i, /ተመላሽ/, /መመለስ/, /መቀየር/],
  },
  delivery: {
    ask: [/\b(do you deliver|can you deliver|delivery (fee|cost|price|charge|time|area)|how much (is|for) delivery|ship(ping)? (to|fee|cost)|deliver to)\b/i, /(ታደርሳላችሁ|ያደርሳሉ|ማድረስ ይቻላል|ዴሊቨሪ|ትልካላችሁ)/],
    covered: [/deliver/i, /shipping/i, /courier/i, /pick.?up/i, /ማድረስ/, /ዴሊቨሪ/, /ያደርሳ/, /ይደርሳል/],
  },
  timeline: {
    ask: [/\b(how long (does|will|to)|how many days|lead time|turnaround|when (will|can) (it|i|you) (be|get|have|ready|deliver)|ready by)\b/i, /(ስንት ቀን|መቼ ይደርሳል|መቼ ይደርሳል|መቼ ይዘጋጃል)/],
    covered: [/\b\d+\s*(-|to)?\s*\d*\s*(day|days|hour|hours|week|weeks)\b/i, /same.?day/i, /turnaround/i, /lead time/i, /ቀን/, /ሰዓት/],
  },
  discount: {
    ask: [/\b(discount|any (deal|offer|promo)|best price|cheaper|bulk price|wholesale|negotiat)\b/i, /(ቅናሽ|ዋጋ ቀንሱ|ቀንሱልኝ)/],
    covered: [/discount/i, /bulk/i, /wholesale/i, /promo/i, /off\b/i, /ቅናሽ/],
  },
  installments: {
    ask: [/\b(installments?|pay (later|in parts|monthly)|on credit|deposit first|pay half)\b/i, /(ዱቤ|በከፊል|ቀብድ)/],
    covered: [/installment/i, /pay later/i, /credit/i, /deposit/i, /half/i, /ዱቤ/, /ቀብድ/],
  },
};

const QUESTION_HINT = /[?？]|^\s*(do|does|can|could|is|are|what|whats|what's|how|when|will|would|any)\b|(ነው|ናቸው|ይቻላል|አለ|ይሆን|ወይ)\s*[?？]?\s*$/i;
// An order in progress (phone number, quantity + "I want", address) belongs to
// checkout / the brain, which collect details — not to the gate.
const ORDER_LIKE = /\b\d{7,}\b|\b(i'?ll take|i want \d|i'?d like \d|place (an |my )?order|my (phone|address) is)\b|(እፈልጋለሁ|ልግዛ|እገዛለሁ)/i;

/** Which policy topic a customer message asks about, or null. */
export function detectPolicyTopic(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 400) return null;
  if (ORDER_LIKE.test(t)) return null;
  if (!QUESTION_HINT.test(t)) return null;
  for (const [topic, def] of Object.entries(POLICY_TOPICS)) {
    if (def.ask.some(re => re.test(t))) return topic;
  }
  return null;
}

/** True when any owner-authored text mentions the topic. */
export function isTopicCovered(topic, ownerTexts) {
  const def = POLICY_TOPICS[topic];
  if (!def) return true;
  const corpus = (ownerTexts || []).filter(Boolean).join('\n');
  return def.covered.some(re => re.test(corpus));
}

/**
 * Everything the owner has said themselves, as plain strings. `chunks` are
 * knowledge-base hits for this question, already filtered to owner-authored
 * sources (see knowledge.js isOwnerAuthoredSource).
 */
export function ownerAuthoredTexts(business, { products = [], chunks = [] } = {}) {
  const out = [];
  for (const r of business?.owner_instructions || []) {
    if (r?.rule) out.push(r.rule);
    if (r?.question) out.push(r.question);
    if (r?.answer) out.push(r.answer);
  }
  out.push(business?.description, business?.business_hours);
  for (const p of products) out.push(p?.description);
  for (const c of chunks) out.push(c?.content);
  return out.filter(x => typeof x === 'string' && x.trim());
}

/** The hold message the customer sees, in their language. */
export function holdMessage(question, ownerFirstName, isAmharicText) {
  const who = (ownerFirstName || '').trim();
  return isAmharicText
    ? `ይህንን ከ${who || 'ባለቤቱ'} ጋር አረጋግጬ በቅርቡ እመልስልዎታለሁ 🙏`
    : `Let me confirm that with ${who || 'the owner'} and get right back to you 🙏`;
}
