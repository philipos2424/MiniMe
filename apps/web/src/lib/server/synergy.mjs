/**
 * synergy — "who should I sell TO", not "who sells what I need".
 *
 * WHY THIS EXISTS
 * Harvested from apps/bot's Synergy Engine (`b2b_research.js findSynergies`)
 * before that app's orphaned B2B code was deleted (`transaction_manager.js`
 * had zero importers anywhere; `handlers/research.js` and `handlers/command.js`
 * didn't even pass `node --check`). The core idea was sound and unreplicated
 * on the live path: normal research discovery matches a QUERY against
 * businesses ("laptop suppliers"); synergy discovery inverts it — given MY
 * OWN business's category, which OTHER categories of business would
 * plausibly want what I offer? 5 of the 14 campaigns stuck open on
 * 2026-08-12/13 were exactly this question ("potential B2B partners in
 * Addis Ababa that would benefit from iConnect/MiniMe AI automation
 * services") with no code path built for it.
 *
 * The original lived on a separate `ICP keyword` axis ('Agency', 'CEO', ...)
 * that doesn't correspond to anything in this schema. This version maps
 * between the same 15 canonical categories categoryMap.mjs already
 * establishes as ground truth, so synergy results ride the exact same
 * grounded discovery (rankCandidates, activity tiering, the Truth Guard) as
 * every other research campaign — this is a different WAY to pick candidate
 * categories, never a different way to invent businesses inside them.
 *
 * A heuristic, stated as one: entries are plausible business relationships,
 * not measured facts, and every category maps to at least
 * training_consulting/wholesale_supply/it_tech as a floor so a synergy
 * search is never empty by construction.
 */
import { canonicalCategory, CANONICAL_CATEGORIES } from './categoryMap.mjs';

const FLOOR = ['training_consulting', 'wholesale_supply', 'it_tech'];

/** category → the OTHER categories whose businesses would plausibly want it as a customer. */
export const SYNERGY_MAP = {
  it_tech:               ['wholesale_supply', 'clothing_fashion', 'food_beverage', 'beauty_wellness', 'events_entertainment', 'construction_interior'],
  branding_design:       ['it_tech', 'food_beverage', 'clothing_fashion', 'events_entertainment', 'training_consulting'],
  printing_signage:      ['events_entertainment', 'food_beverage', 'construction_interior', 'clothing_fashion'],
  photography_video:     ['events_entertainment', 'clothing_fashion', 'food_beverage', 'branding_design'],
  training_consulting:   CANONICAL_CATEGORIES.filter(c => c !== 'training_consulting' && c !== 'other'), // consulting sells to everyone
  wholesale_supply:      ['food_beverage', 'catering_food', 'clothing_fashion', 'electronics_phones', 'construction_interior'],
  transport_delivery:    ['wholesale_supply', 'food_beverage', 'clothing_fashion', 'electronics_phones'],
  catering_food:         ['events_entertainment', 'training_consulting', 'it_tech'],
  food_beverage:         ['events_entertainment', 'catering_food'],
  events_entertainment:  ['food_beverage', 'photography_video', 'printing_signage', 'branding_design'],
  clothing_fashion:      ['photography_video', 'branding_design', 'events_entertainment'],
  beauty_wellness:       ['events_entertainment', 'branding_design', 'training_consulting'],
  construction_interior: ['wholesale_supply', 'transport_delivery', 'branding_design'],
  electronics_phones:    ['it_tech', 'wholesale_supply', 'training_consulting'],
  vehicles_automotive:   ['transport_delivery', 'wholesale_supply', 'branding_design'],
};

/**
 * Categories worth searching for a synergy campaign anchored on `myCategory`.
 * Always includes the FLOOR so an unmapped or generic category still returns
 * something plausible rather than nothing — but the floor is explicit and
 * small, never a silent fallback to "everyone".
 */
export function synergyCategoriesFor(myCategory) {
  const key = canonicalCategory(myCategory);
  const mapped = (key && SYNERGY_MAP[key]) || [];
  return [...new Set([...mapped, ...FLOOR])].filter(c => c !== key);
}

/** True when a free-text query is asking the inverted "who should I sell to" question. */
export function isSynergyQuery(query) {
  return /\b(benefit|synergy|who needs|who (can|would) (use|benefit)|find (businesses|clients|customers) for me|potential (b2b )?partners?)\b/i
    .test(String(query || ''));
}
