/**
 * Grounding gate — pure functions, no network, no database.
 *
 * Two jobs:
 *
 * 1. Policy questions. MiniMe confidently invented a warranty policy
 *    ("it doesn't come with a traditional warranty…") and a refund policy
 *    ("we don't have a traditional refund policy, but…") that existed nowhere
 *    in the shop's knowledge. The old knowledge-gap check only fired when the
 *    model's own draft already sounded unsure AND retrieval found nothing, so a
 *    confident guess always went out. Promises about money back, warranties,
 *    delivery and turnaround are exactly where a guess costs the owner. So: if
 *    a customer asks a policy question and nothing the owner taught covers that
 *    topic, MiniMe holds the customer and asks the owner instead of answering.
 *
 * 2. Owner rules in prompts. The fast path (≈70% of replies) took the first 5
 *    owner_instructions entries. On real shops the first entries are generic
 *    category templates, so the owner's own rules were cut off — iconnect's
 *    "don't confuse iConnect with MiniMe" was entry 14 and never reached the
 *    model, which then told a customer MiniMe is "the AI agent that runs
 *    iConnect". The brain prompt listed FAQ entries as rules ("- undefined").
 *    ownerRulesForPrompt puts the owner's own rules first and caps by length.
 */

// Each topic: what a customer's question about it looks like, and the words
// that mean the owner's knowledge covers it.
export const POLICY_TOPICS = {
  warranty: {
    ask: /\b(warrant(y|ies)|guarantee[ds]?)\b|ዋስትና/i,
    covers: ['warrant', 'guarantee', 'ዋስትና'],
  },
  refund_return: {
    // "return" only as returning an item: "return it", "return policy",
    // "returns" — not "I will return tomorrow".
    ask: /\b(refunds?|money back|returns|returnable|return (it|this|them|the|an?|my|policy)|exchange (it|this|them|the|an?|my)|exchanges|replacements?|replace (it|this|them|the|my))\b|ተመላሽ|መመለስ|ይመለሳል|መቀየር|ይቀየራል/i,
    covers: ['refund', 'return', 'exchange', 'replace', 'money back', 'ተመላሽ', 'መመለስ', 'መቀየር'],
  },
  delivery: {
    ask: /\b(deliver(y|ies|s)?|shipping|ship (it|to)|courier)\b|ማድረስ|ታደርሳላችሁ|ታደርሳላችሁ|ይደርሳል|ዴሊቨሪ/i,
    covers: ['deliver', 'shipping', 'ship ', 'courier', 'pickup', 'pick up', 'ማድረስ', 'ዴሊቨሪ', 'ይደርሳል'],
  },
  turnaround: {
    // About how long an order takes, not shop visits ("when can I come").
    ask: /\bhow (long|many days)\b|\bturnaround\b|\bready by\b|\bwhen (will|would|can) (it|they|my order|the order|the cards?) (be ready|be done|arrive|get here|come)\b|\bwhen (can|will) i (get|receive|have|pick up) (it|them|my|the)\b|ስንት ቀን|መቼ ይደርሳል|መቼ ይዘጋጃል|መቼ ይደርሰኛል/i,
    covers: ['day', 'week', 'hour', 'turnaround', 'ready in', 'same day', 'ቀን', 'ሳምንት', 'ሰዓት'],
  },
};

// A message only counts as a policy QUESTION when it asks something. "deliver
// to Bole, my phone is 0911…" is an order, handled by the order flow.
const ASKS = /\?|\b(do|does|can|could|will|would|is|are|what|how|when|where|which|any|if)\b|ይቻላል|አለ|ነው|ወይ|እንዴት|መቼ|ስንት|የት|ይሆናል/i;

// Order details that mean "I'm buying", not "tell me your policy".
const ORDER_DETAILS = /\b0?9\d{8}\b|\+2519\d{8}\b|\bmy (phone|number|address) is\b/i;

/** Policy topics a message asks about (empty when it isn't a policy question). */
export function policyTopics(text) {
  const s = String(text || '');
  if (!s.trim() || !ASKS.test(s) || ORDER_DETAILS.test(s)) return [];
  return Object.keys(POLICY_TOPICS).filter(k => POLICY_TOPICS[k].ask.test(s));
}

/** True when any knowledge text mentions one of the topic's coverage words. */
export function topicCovered(topic, knowledgeText) {
  const hay = String(knowledgeText || '').toLowerCase();
  if (!hay) return false;
  return POLICY_TOPICS[topic].covers.some(w => hay.includes(w.toLowerCase()));
}

/**
 * Should MiniMe ask the owner instead of answering?
 * @returns {{ ask: boolean, topics: string[], uncovered: string[] }}
 */
export function policyGapDecision(text, knowledgeText) {
  const topics = policyTopics(text);
  const uncovered = topics.filter(t => !topicCovered(t, knowledgeText));
  return { ask: uncovered.length > 0, topics, uncovered };
}

/**
 * Everything the owner has told MiniMe, as one searchable string: rules, FAQ
 * pairs, facts, description, products, and retrieved knowledge chunks.
 */
export function knowledgeTextFor(business, { products = [], chunks = [] } = {}) {
  const parts = [];
  for (const r of business?.owner_instructions || []) {
    if (r?.rule) parts.push(r.rule);
    if (r?.question) parts.push(r.question);
    if (r?.answer) parts.push(r.answer);
  }
  for (const f of business?.notification_prefs?.owner_facts || []) if (typeof f === 'string') parts.push(f);
  if (business?.description) parts.push(business.description);
  for (const p of products || []) {
    if (p?.name) parts.push(p.name);
    if (p?.description) parts.push(p.description);
  }
  for (const c of chunks || []) parts.push(typeof c === 'string' ? c : (c?.content || ''));
  return parts.join('\n');
}

// Owner rules come from several sources. Anything the owner typed outranks
// generated templates; FAQ pairs are answers, not rules.
const TEMPLATE_SOURCES = new Set(['category_template', 'template', 'default']);

/**
 * Owner rules for a prompt: owner-typed rules first (newest first, since later
 * rules usually correct earlier ones), then templates; deduped; capped by
 * characters so long lists still fit without silently dropping the owner's own.
 */
export function ownerRulesForPrompt(ownerInstructions, { maxChars = 1500 } = {}) {
  const list = Array.isArray(ownerInstructions) ? ownerInstructions : [];
  const rules = list.filter(r => r && r.source !== 'faq' && typeof r.rule === 'string' && r.rule.trim());
  const own = rules.filter(r => !TEMPLATE_SOURCES.has(r.source)).reverse();
  const templates = rules.filter(r => TEMPLATE_SOURCES.has(r.source));
  const out = [];
  const seen = new Set();
  let used = 0;
  for (const r of [...own, ...templates]) {
    const text = r.rule.trim();
    const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (seen.has(key)) continue;
    if (used + text.length + 3 > maxChars) break;
    seen.add(key);
    used += text.length + 3;
    out.push(text);
  }
  return out;
}

/** FAQ pairs only, as "Q: …\nA: …" entries. */
export function faqPairsForPrompt(ownerInstructions, { max = 12 } = {}) {
  const list = Array.isArray(ownerInstructions) ? ownerInstructions : [];
  return list
    .filter(r => r && r.source === 'faq' && r.question && r.answer)
    .slice(-max)
    .map(f => `Q: ${f.question}\nA: ${f.answer}`);
}
