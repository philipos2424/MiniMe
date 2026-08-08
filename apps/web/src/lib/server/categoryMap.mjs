/**
 * categoryMap — the single source of truth for MiniMe's business taxonomy.
 *
 * WHY THIS EXISTS
 * `businesses.category` was written from two different places with two
 * different contracts: the web onboarding/settings routes validated against a
 * fixed list, while teaching.js wrote whatever the LLM extracted from an
 * owner's chat. The result was 150+ distinct category strings across 385
 * listable shops — "electronics retail", "pigeon breeding", "crafts and
 * aerospace development" — in a column the search ranker treated as an enum.
 *
 * Every categorized search silently deleted the shops whose category string
 * didn't match exactly. A search for "laptop" (→ electronics_phones) dropped
 * seven real laptops filed under "electronics retail" and two iPhones filed
 * under "retail"/"other", returning 3 of 12 matching products.
 *
 * So: one canonical list, one normalizer, applied at every write AND at read
 * time as a fallback (so search correctness never depends on a backfill having
 * been run, or on every future writer remembering to normalize).
 *
 * DESIGN NOTES
 * - Rules are stem-matched regexes, ordered most-specific-first, NOT an
 *   exhaustive lookup table. Freeform input keeps arriving; a rule set degrades
 *   gracefully on strings nobody has seen yet, a lookup table doesn't.
 * - Unknown and too-generic inputs ("retail", "services", "other", "platform")
 *   normalize to null, meaning "makes no category claim". Callers treat null as
 *   eligible-for-everything rather than forcing a wrong bucket. Note this maps
 *   the literal id 'other' to null too: 'other' carries no discriminating
 *   signal, so it should never be the basis for excluding or penalizing a shop.
 * - Mistakes here are cheap BY CONSTRUCTION: consumers apply a ranking penalty,
 *   never a hard filter (see searchRanker.rankCandidates). A miscategorized
 *   shop ranks a little lower; it does not vanish.
 */

/** The 14 real categories + 'other'. Order matches the bot's browse keyboard. */
export const CANONICAL_CATEGORIES = [
  'branding_design',
  'printing_signage',
  'photography_video',
  'catering_food',
  'food_beverage',
  'it_tech',
  'events_entertainment',
  'clothing_fashion',
  'beauty_wellness',
  'construction_interior',
  'transport_delivery',
  'training_consulting',
  'wholesale_supply',
  'electronics_phones',
  'other',
];

const CANONICAL_SET = new Set(CANONICAL_CATEGORIES);

/**
 * Strings that look categorical but carry no signal. Checked BEFORE the rules
 * so a generic word can't be dragged into a bucket by an incidental stem
 * ("real estate consulting" must not become training_consulting).
 */
const NO_SIGNAL_RE = /^(other|others|general|misc(ellaneous)?|n\/?a|none|business|shop|store|retail(\s*(store|shop))?|online\s*(shop|store|retail|marketplace)|e-?commerce|ecommerce|service|services|platform|product|products|company|send me a direct message)$/;

/**
 * Trades that sit outside the 15 buckets entirely. Checked before the rules so
 * an incidental stem can't drag them somewhere a buyer would never look for
 * them: "real estate consulting" is not a consultancy, "visa services" is not
 * a courier, healthcare is not a beauty salon. Better to make no claim — a
 * no-claim shop stays eligible for every query instead of ranking under a
 * category its customers don't search.
 */
const NO_SIGNAL_CONTAINS = /\b(real estate|visa service|customer service|used kitchen|health ?care|dental|automotive|car dealership)\b/;

/**
 * Ordered rules. First match wins, so more specific buckets sit above the
 * broader ones they'd otherwise be swallowed by:
 *   printing before branding  → "graphic design and printing" is a print shop
 *   electronics before it_tech → "computer retail" sells boxes, not software
 *   it_tech before branding    → "software development and brand design" is a dev shop
 *   catering before food       → "food supplier" is trade, not a restaurant
 *   beauty before training     → "fitness training" is wellness, not a course
 *   wholesale before transport → "pharmaceutical import" is supply, not logistics
 */
const RULES = [
  ['photography_video', /\b(photograph|photo studio|videograph|video (edit|produc)|cinemato|youtube channel|music production)/],
  ['printing_signage', /\b(print|signage|banner|flyer|sticker|decal|billboard|packaging|business card)/],
  ['electronics_phones', /\b(electronic|phone|mobile|laptop|computer|tablet|home appliance|networking product|nfc|security (hardware|system)|gadget)/],
  ['it_tech', /\b(software|web (dev|design|app)|website|app dev|tech|technolog|saas|platform|payment gateway|gaming|game |cyber|it (service|support|solution)|information technology|digital (product|service|solution|subscription|account|document))/],
  // `marketing`, not the `market` stem — the stem ate "fish market" and would
  // have eaten every shop with "Market" in a trade-style category name.
  ['branding_design', /\b(brand|logo|graphic design|digital design|product design|creative service|marketing|advertis|promotion|social media|copywrit|lead generation)/],
  ['catering_food', /\b(catering|food (production|product|supplier|delivery)|injera|buffet)/],
  ['food_beverage', /\b(restaurant|cafe|coffee|bakery|pastry|cake|juice|grocer|bars?\b|beverage|food|fish market|candy)/],
  ['clothing_fashion', /\b(cloth|fashion|boutique|garment|dress|tailor|shoe|footwear|jewel|thrift|apparel|habesha)/],
  // No bare `health`/`dental`: medical trades are excluded above, and the ones
  // that belong here (counselling, therapy) are matched on their own stems.
  ['beauty_wellness', /\b(beaut|cosmetic|skin ?care|hair ?care|hair|salon|spa\b|barber|makeup|perfume|nail|wellness|supplement|fitness|counsel|therap|oral care)/],
  // No bare `kitchen`: it caught commercial-equipment resale, which is trade,
  // not interiors. Fitted kitchens still land here via furniture/interior.
  ['construction_interior', /\b(construction|interior|furniture|home decor|lighting|paint|metal|plumb|electrician|renovat|building material|machine service|engineering|solar|renewable|water treatment|energy)/],
  ['wholesale_supply', /\b(wholesale|suppl|bulk|distribut|pharmaceutic|laborator|stationery|mineral|gem)/],
  ['transport_delivery', /\b(transport|deliver|courier|shipping|logistic|import|export|freight|moving|tour|travel|car rental)/],
  ['events_entertainment', /\b(event|wedding|party|dj\b|decorat|florist|flower|ticket|entertain)/],
  ['training_consulting', /\b(train|consult|coach|tutor|educat|academy|school|recruit|staffing|resume|translat|freelanc|mentor|delegation)/],
];

/**
 * Normalize any category string to a canonical id, or null when it carries no
 * usable signal. Null is a valid, meaningful answer — never coerce it to
 * 'other', which would let a shop be penalized for a claim it never made.
 */
export function canonicalCategory(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim().replace(/\s+/g, ' ');
  if (!s) return null;

  // Already canonical — cheapest and most common path once the backfill lands.
  // 'other' short-circuits to null here (see NO_SIGNAL_RE rationale above).
  if (CANONICAL_SET.has(s)) return s === 'other' ? null : s;

  if (NO_SIGNAL_RE.test(s) || NO_SIGNAL_CONTAINS.test(s)) return null;

  for (const [id, re] of RULES) if (re.test(s)) return id;
  return null;
}

/**
 * Every canonical category a business row claims, from `category` and the
 * `categories[]` array (both freeform in the wild). Deduped, nulls dropped.
 * Returns [] for a shop that makes no usable claim.
 */
export function canonicalCategoriesOf(row) {
  if (!row) return [];
  const out = new Set();
  const add = v => { const c = canonicalCategory(v); if (c) out.add(c); };
  // A backfilled column, when present, is authoritative for `category`.
  add(row.category_canonical || row.category);
  if (Array.isArray(row.categories)) for (const c of row.categories) add(c);
  return [...out];
}

/** True when `row` can plausibly serve `category`. A shop making no canonical
 *  claim is eligible for everything — absence of evidence is not evidence of
 *  mismatch, and excluding it is what broke search in the first place. */
export function matchesCategory(row, category) {
  const want = canonicalCategory(category);
  if (!want) return true;
  const have = canonicalCategoriesOf(row);
  if (!have.length) return true;
  return have.includes(want);
}
