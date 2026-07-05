/**
 * Business-lifecycle leak funnel for the Pulse triage dashboard.
 *
 * Tracks a cohort of businesses that signed up in a window through to the
 * point where they've actually made money, so the founder can see exactly
 * which stage of "get found, get messaged, get paid" is bleeding people —
 * instead of a live feed of individually uninterpretable events.
 */
import { supabase } from './db';

const PAID = ['paid', 'fulfilled', 'completed'];

const STAGE_LABELS = [
  'Signups',
  'Searchable',
  'Surfaced in a search',
  'Messaged',
  'Ordered',
];

// Static, non-LLM explanations for the most common leak point per stage —
// keeps the "why" instant and free.
const LEAK_HINTS = {
  1: 'Businesses are signing up but never becoming searchable — check onboarding completion and the b2b_discoverable default.',
  2: 'Searchable businesses are never surfaced in a search — check embeddings coverage, category tagging, or product data richness.',
  3: 'Businesses get surfaced but nobody messages them — check profile quality (photos, pricing, tagline) or response speed.',
  4: 'Businesses get messaged but never convert to an order — check pricing, response quality, or checkout friction.',
};

/**
 * Cohort funnel: businesses that signed up in the window, tracked through to
 * revenue. Each stage is a SUBSET of the previous one (same businesses),
 * so pctOfPrevious is a true conversion rate, not just a smaller total.
 */
export async function businessLeakFunnel({ days = 30 } = {}) {
  const sb = supabase();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data: signups } = await sb.from('businesses')
    .select('id, b2b_discoverable')
    .gte('created_at', since);
  const signupIds = (signups || []).map(b => b.id);
  if (!signupIds.length) {
    return {
      stages: STAGE_LABELS.map((label, i) => ({ label, count: 0, pctOfPrevious: i === 0 ? null : 0 })),
      leakStage: null,
      leakHint: null,
      coverage: { embedding: null, products: null },
    };
  }

  const searchableIds = (signups || []).filter(b => b.b2b_discoverable).map(b => b.id);

  // Surfaced: appears in ANY search_logs.results_profile_ids, ever — being
  // found is the milestone, regardless of when. Scan is bounded to recent
  // logs (90d) to keep this cheap; older-than-that surfacing is stale anyway.
  let surfacedIds = [];
  if (searchableIds.length) {
    const since90 = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data: logs } = await sb.from('search_logs')
      .select('results_profile_ids')
      .gte('created_at', since90)
      .not('results_profile_ids', 'is', null)
      .limit(5000);
    const surfacedSet = new Set();
    const wanted = new Set(searchableIds);
    for (const l of logs || []) {
      for (const id of l.results_profile_ids || []) if (wanted.has(id)) surfacedSet.add(id);
    }
    surfacedIds = [...surfacedSet];
  }

  // Messaged: search_referrals with first_message_at set, for surfaced businesses.
  let messagedIds = [];
  let messagedRefs = [];
  if (surfacedIds.length) {
    const { data: refs } = await sb.from('search_referrals')
      .select('business_id, customer_telegram_id, first_message_at')
      .in('business_id', surfacedIds)
      .not('first_message_at', 'is', null);
    messagedRefs = refs || [];
    messagedIds = [...new Set(messagedRefs.map(r => r.business_id))];
  }

  // Ordered: resolve referral (business_id + customer_telegram_id) -> customers.id
  // -> orders with a paid-family status.
  let orderedIds = [];
  if (messagedRefs.length) {
    const { data: custRows } = await sb.from('customers')
      .select('id, business_id, telegram_id')
      .in('business_id', messagedIds);
    const custKey = (bizId, tgId) => `${bizId}:${tgId}`;
    const custMap = new Map((custRows || []).map(c => [custKey(c.business_id, String(c.telegram_id)), c.id]));
    const custIds = messagedRefs
      .map(r => custMap.get(custKey(r.business_id, String(r.customer_telegram_id))))
      .filter(Boolean);
    if (custIds.length) {
      const { data: orders } = await sb.from('orders')
        .select('business_id, customer_id, status')
        .in('customer_id', [...new Set(custIds)])
        .in('status', PAID);
      const custToBiz = new Map((custRows || []).map(c => [c.id, c.business_id]));
      orderedIds = [...new Set((orders || [])
        .filter(o => custToBiz.get(o.customer_id) === o.business_id)
        .map(o => o.business_id))];
    }
  }

  // Coverage diagnostics for the "Surfaced in a search" stage — the two most
  // common root causes of that leak, so the founder doesn't have to guess.
  // Counts only (never fetches the actual embedding vector — that's bandwidth
  // nobody needs just to check null-ness).
  let embeddingCoverage = null;
  let productCoverage = null;
  if (searchableIds.length) {
    const [{ count: embeddedCount }, { data: prodRows }] = await Promise.all([
      sb.from('businesses').select('id', { count: 'exact', head: true })
        .in('id', searchableIds).not('search_embedding', 'is', null),
      sb.from('products').select('business_id').eq('is_active', true).in('business_id', searchableIds).limit(5000),
    ]);
    const withProducts = new Set((prodRows || []).map(p => p.business_id)).size;
    embeddingCoverage = { covered: embeddedCount || 0, total: searchableIds.length, pct: Math.round(((embeddedCount || 0) / searchableIds.length) * 100) };
    productCoverage = { covered: withProducts, total: searchableIds.length, pct: Math.round((withProducts / searchableIds.length) * 100) };
  }

  const counts = [signupIds.length, searchableIds.length, surfacedIds.length, messagedIds.length, orderedIds.length];
  const stages = STAGE_LABELS.map((label, i) => ({
    label,
    count: counts[i],
    pctOfPrevious: i === 0 ? null : (counts[i - 1] > 0 ? Math.round((counts[i] / counts[i - 1]) * 100) : 0),
  }));

  // Worst conversion among stages 1..4 (index into stages, skipping stage 0).
  let leakStage = null;
  let lowestPct = 101;
  for (let i = 1; i < stages.length; i++) {
    if (stages[i].pctOfPrevious < lowestPct) { lowestPct = stages[i].pctOfPrevious; leakStage = i; }
  }

  // When the leak IS "surfaced in a search", swap in the real coverage
  // numbers instead of a generic hint — that's the actual diagnosis.
  let leakHint = leakStage != null ? LEAK_HINTS[leakStage] : null;
  if (leakStage === 2 && embeddingCoverage && productCoverage) {
    leakHint = `Only ${embeddingCoverage.pct}% of searchable businesses have a search embedding, and ${productCoverage.pct}% have any products — fix whichever is lower first.`;
  }

  return { stages, leakStage, leakHint, coverage: { embedding: embeddingCoverage, products: productCoverage } };
}
