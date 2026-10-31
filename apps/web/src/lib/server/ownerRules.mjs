/**
 * Owner rules and FAQ answers as they go into reply prompts. Pure, so it can
 * be tested with node --test.
 *
 * Why: the fast path (≈70% of replies) took the FIRST 5 owner_instructions
 * entries. On real shops the first entries are generic category templates
 * ("Always collect project requirements before giving a quote…"), so the
 * owner's own rules were cut off. iconnect's "don't confuse iConnect with
 * MiniMe" is entry 14; it never reached the model, which told a customer that
 * MiniMe is "the AI agent that runs iConnect". 39 shops have more than 5 rules.
 * The fast path also took the OLDEST 8 FAQ answers, so new corrections were
 * dropped, and the brain listed FAQ entries as rules ("- undefined").
 */

// Rules generated for a category, not typed by the owner.
const TEMPLATE_SOURCES = new Set(['category_template', 'template', 'default']);

/**
 * Owner-typed rules first (newest first: later rules usually refine earlier
 * ones), then templates; FAQ entries excluded; deduped; capped by characters
 * instead of count, so a long list never silently drops the owner's own rules.
 */
export function ownerRulesForPrompt(ownerInstructions, { maxChars = 1500 } = {}) {
  const list = Array.isArray(ownerInstructions) ? ownerInstructions : [];
  // Rules scoped to family, friends or one person belong to Secretary only
  // (secretaryBrain.mjs) — never to the shop bot talking to customers.
  const rules = list.filter(r => r && r.source !== 'faq' && typeof r.rule === 'string' && r.rule.trim()
    && !r.person_name && !r.person_tg && !['family', 'friends'].includes(r.audience));
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

/** The newest FAQ pairs, as "Q: …\nA: …" entries. */
export function faqPairsForPrompt(ownerInstructions, { max = 12 } = {}) {
  const list = Array.isArray(ownerInstructions) ? ownerInstructions : [];
  return list
    .filter(r => r && r.source === 'faq' && r.question && r.answer)
    .slice(-max)
    .map(f => `Q: ${f.question}\nA: ${f.answer}`);
}
