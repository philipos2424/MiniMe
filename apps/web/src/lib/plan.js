/**
 * Plan / entitlement helpers (client-safe, pure).
 *
 * The promise, in one line: **MiniMe always answers your customers.** That is
 * true on Free, forever, unmetered. Everything Pro sells is on top of that.
 *
 * Free gets the whole product at a workable size:
 *   • unlimited customer replies from your shop bot
 *   • a permanent MiniMe Search listing (ranked below Pro shops)
 *   • Secretary, capped at FREE_LIMITS.secretaryRepliesPerMonth per month
 *   • up to FREE_LIMITS.products products
 *
 * Pro removes the ceilings and adds the power tools (Advisor, Broadcast,
 * Market insights, top-of-search ranking).
 *
 * Nothing a Free shop depends on is ever switched off — limits taper, they
 * don't break. During the 1-month trial everything is unlocked so owners feel
 * the full product before the ask.
 *
 * Source of truth on the business row: plan_tier ('free'|'pro'),
 * subscription_status ('trial'|'active'|'expired'|'cancelled'|'pending_review'),
 * trial_ends_at, subscription_expires_at.
 */

// Free-tier limits. These taper the experience; they never hard-block core
// value. Each one shows an upgrade sheet rather than breaking the app.
export const FREE_LIMITS = {
  products: 30,
  // Secretary (replies sent from the owner's OWN Telegram account) is available
  // on Free, capped per calendar month. Pro is uncapped. Enforced in
  // api/agent-bot/webhook via the secretary_reply_bump() RPC.
  secretaryRepliesPerMonth: 100,
  // The full agent (MiniMe sends replies himself) runs on Free for this many AI
  // replies per calendar month, drafts included; after that, drafts until the
  // month rolls over. Counted by the ai_reply_bump() RPC in replyEngine.
  aiRepliesPerMonth: 100,
};

export const SECRETARY_FREE_MONTHLY_CAP = FREE_LIMITS.secretaryRepliesPerMonth;

// ── The autonomy line ────────────────────────────────────────────────────────
// This is what Pro actually sells.
//
//   Free  — MiniMe SENDS replies himself for the first 100 AI replies of the
//           month (FREE_LIMITS.aiRepliesPerMonth), then WRITES them and the
//           owner taps send. Nothing is gated: every customer still gets answered.
//   Pro   — MiniMe sends every reply himself. Nights, weekends, while the owner
//           is with a walk-in customer, at 2am.
//
// Gating autonomy instead of access keeps the promise ("MiniMe always answers
// your customers") completely intact while charging for the only thing an
// owner genuinely misses: not having to be there. It also maps onto the trust
// ladder the product already had, so upgrading isn't a new concept to learn.
//
// Must equal TRUST_LEVELS.SUPERVISED (packages/shared/constants.js). Kept as a
// literal so this module stays dependency-free and client-safe; a test asserts
// the two agree.
export const FREE_MAX_TRUST_LEVEL = 1;

/**
 * The trust level a business may actually operate at right now.
 *
 * CRITICAL: this caps at READ time and never writes to the row. The owner's
 * chosen trust_level is preserved through a lapse, so upgrading restores their
 * exact setting instantly — and an expiring trial can never silently rewrite
 * how their shop behaves. (An earlier version of the trial checker had a
 * standing warning never to touch trust_level for precisely this reason.)
 */
export function effectiveTrustLevel(business) {
  const stored = Number(business?.trust_level ?? FREE_MAX_TRUST_LEVEL);
  if (planStatus(business).isPro) return stored;
  if (freeAiRepliesLeft(business) > 0) return stored;
  return Math.min(stored, FREE_MAX_TRUST_LEVEL);
}

/** Calendar month the free AI-reply allowance is counted in (UTC, YYYY-MM). */
export function aiReplyPeriod(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

/**
 * Free AI replies left this month, from the counter on the business row. A row
 * without the counter columns (migration 062 not applied, or a partial select)
 * reports 0, so an unknown allowance behaves like Free always did — drafts —
 * and can never hand out unlimited auto-send.
 */
export function freeAiRepliesLeft(business, date = new Date()) {
  if (!business || !('ai_replies_period' in business)) return 0;
  const used = business.ai_replies_period === aiReplyPeriod(date) ? Number(business.ai_replies_count || 0) : 0;
  return Math.max(0, FREE_LIMITS.aiRepliesPerMonth - used);
}

/**
 * The trust level for ONE AI reply, given the count after bumping the counter
 * for it (or null if the counter couldn't be bumped). Pro: the owner's level.
 * Free: the owner's level while within the monthly allowance, drafts beyond it
 * or when the count is unknown.
 */
export function trustLevelForReply(business, countAfterBump) {
  const stored = Number(business?.trust_level ?? FREE_MAX_TRUST_LEVEL);
  if (planStatus(business).isPro) return stored;
  if (countAfterBump != null && countAfterBump <= FREE_LIMITS.aiRepliesPerMonth) return stored;
  return Math.min(stored, FREE_MAX_TRUST_LEVEL);
}

/** True when the owner has picked an autonomy level their plan can't run. */
export function isTrustLevelCapped(business) {
  return Number(business?.trust_level ?? 0) > effectiveTrustLevel(business);
}

// The features Pro unlocks. Keys are used by <ProGate feature="…"> and the
// Settings lock badges. Copy is the paywall's value pitch — benefit-first.
export const PRO_FEATURES = {
  // The headline gate. Everything else is secondary to this one.
  auto_send: {
    label: 'Auto-send',
    emoji: '🚀',
    pitch: 'On Free, MiniMe sends up to 100 replies a month himself, then writes them for you to send. On Pro there\'s no limit — he sends every reply, nights and Sundays included.',
  },
  advisor: {
    label: 'Advisor',
    emoji: '✨',
    pitch: 'Ask MiniMe anything about your business — what to restock, who your best customers are, what to focus on today.',
  },
  broadcast: {
    label: 'Broadcast',
    emoji: '📢',
    pitch: 'Message all your customers at once — announce a sale, a new arrival, or a restock in one tap.',
  },
  // Secretary itself is a FREE feature (capped at FREE_LIMITS
  // .secretaryRepliesPerMonth). This entry is the paywall for lifting the cap.
  secretary_unlimited: {
    label: 'Unlimited secretary',
    emoji: '🤝',
    pitch: `MiniMe replies from your own Telegram, as you. Free covers ${FREE_LIMITS.secretaryRepliesPerMonth} messages a month — Pro never stops.`,
  },
  market_insights: {
    label: 'Market insights',
    emoji: '🔎',
    pitch: 'See exactly what shoppers search for that you don\'t stock yet — and add it before your competitors.',
  },
  search_ranking: {
    label: 'Top of MiniMe Search',
    emoji: '🔝',
    pitch: 'Your shop stays listed on MiniMe Search either way — Pro puts you above the free shops when a buyer searches your category.',
  },
  unlimited_products: {
    label: 'Unlimited products',
    emoji: '📦',
    pitch: 'List as many products as you sell. Free shops can list up to 30.',
  },
};

// ── Plan catalog ─────────────────────────────────────────────────────────────
// MiniMe sells ONE paid plan, Pro, in three billing periods (PRO_PERIODS):
// 1,300 ETB a month, 3,500 for 3 months, 12,000 for a year.
//
// This lives here (client-safe) rather than in lib/server/billing.js so that
// UpgradeModal and the billing page can render prices without pulling the
// service-role Supabase module into the client bundle. billing.js re-exports it.
//
// `business` / `professional` are the retired USD credit tiers, kept only so an
// existing subscriber's row still resolves to a name and price. `legacy: true`
// keeps them out of every upgrade surface — showing "$8 / 200 AI chats" next to
// "Pro / 1,999 ETB" was the biggest trust break in the funnel.
export const PRO_PRICE_ETB = 1300;
export const PRO_PRICE_QUARTER_ETB = 3500; // ≈1,167/month, saves 400
export const PRO_PRICE_ANNUAL_ETB = 12000; // ≈1,000/month, saves 3,600

/**
 * The billing periods an owner can buy. Payment code reads amount and months
 * from here — never hardcode a price, a duration or a plan key elsewhere.
 * Manual payments are checked against `amount`; Chapa maps a verified amount
 * back to a period with periodForAmount().
 */
export const PRO_PERIODS = {
  pro_monthly:   { key: 'pro_monthly',   months: 1,  amount: PRO_PRICE_ETB,         label: 'Monthly' },
  pro_quarterly: { key: 'pro_quarterly', months: 3,  amount: PRO_PRICE_QUARTER_ETB, label: '3 months' },
  pro_annual:    { key: 'pro_annual',    months: 12, amount: PRO_PRICE_ANNUAL_ETB,  label: '1 year' },
};
export function periodForMonths(months) {
  return Object.values(PRO_PERIODS).find(p => p.months === Number(months)) || null;
}
/** The longest period a paid amount covers (5 ETB tolerance), monthly at minimum. */
export function periodForAmount(etb) {
  const paid = Number(etb) || 0;
  return [...Object.values(PRO_PERIODS)].reverse().find(p => paid + 5 >= p.amount) || PRO_PERIODS.pro_monthly;
}
const etb = (n) => `${n.toLocaleString('en-US')} ETB`;
/** What a longer period saves against paying monthly, e.g. 400 for 3 months. */
export function periodSavingEtb(period) {
  return Math.max(0, PRO_PRICE_ETB * period.months - period.amount);
}
export const formatEtb = etb;

/** "1,300 ETB" — the one place the price is formatted for display. */
export const PRO_PRICE_LABEL = `${PRO_PRICE_ETB.toLocaleString('en-US')} ETB`;

export const SUBSCRIPTION_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    chats: -1,
    priceMonthlyUsd: 0,
    priceMonthlyEtb: 0,
    features: [
      'MiniMe sends up to 100 replies a month himself',
      'After that, he writes them and you tap send',
      'Listed on MiniMe Search',
      `Secretary — ${FREE_LIMITS.secretaryRepliesPerMonth} replies/month`,
      `Up to ${FREE_LIMITS.products} products`,
      'Basic analytics',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    chats: -1, // Unlimited — Pro is a feature unlock, not a credit bundle
    priceMonthlyUsd: 9, // ≈1,300 ETB, for the Stripe/PayPal rails only
    priceMonthlyEtb: PRO_PRICE_ETB,
    features: [
      'MiniMe sends every reply himself — no monthly limit',
      'Nights, Sundays, while you serve walk-ins',
      'Top of MiniMe Search',
      'Advisor — business advice on demand',
      'Broadcast to all customers',
      'Market insights — unmet demand in your area',
      'Unlimited products & secretary replies',
      'Priority support',
    ],
  },
  business: {
    id: 'business',
    name: 'Business (legacy)',
    legacy: true,
    chats: 200,
    priceMonthlyUsd: 8,
    priceMonthlyEtb: 1200,
    features: ['200 AI replies', 'Analytics'],
  },
  professional: {
    id: 'professional',
    name: 'Professional (legacy)',
    legacy: true,
    chats: -1,
    priceMonthlyUsd: 15,
    priceMonthlyEtb: 2250,
    features: ['Unlimited AI replies', 'Priority AI', 'Analytics'],
  },
};

/** The only plans an owner may actually buy today. */
export const PURCHASABLE_PLANS = Object.values(SUBSCRIPTION_PLANS)
  .filter(p => !p.legacy && p.id !== 'free');

/** Price in ETB for a plan + duration. Pro uses its period prices (3 months and
 *  a year are discounted); legacy rows fall back to the old ~150 rate. */
export function planPriceEtb(planDef, durationMonths = 1) {
  const period = planDef?.id === 'pro' ? periodForMonths(durationMonths) : null;
  if (period) return period.amount;
  const monthly = planDef?.priceMonthlyEtb ?? Math.round((planDef?.priceMonthlyUsd || 3) * 150);
  return Math.round(monthly * durationMonths);
}

// ── The comparison ───────────────────────────────────────────────────────────
// One row per capability, with BOTH sides stated. Two independent bullet lists
// (what this used to be) make an owner do the diffing themselves: they read
// "Free: 30 products" and "Pro: unlimited products" in different positions and
// have to hold both in their head. Same-row comparison is read at a glance.
//
// Order matters. The first row is the promise that never changes — an owner's
// biggest fear is that paying is the only way to keep their shop answered, and
// the answer is visibly "no" before any limit is mentioned.
//
// `same: true` marks rows where the plans are identical. Render those without
// an upsell — they are reassurance, not a ladder.
export const PLAN_COMPARISON = [
  {
    label: 'MiniMe reads every message and writes the reply',
    free: 'Always — unlimited',
    pro:  'Always — unlimited',
    same: true,
  },
  {
    label: 'MiniMe sends replies himself',
    free: `${FREE_LIMITS.aiRepliesPerMonth} a month, then you tap send`,
    pro:  'Every reply — no limit',
    hero: true,
  },
  {
    label: 'Listed on MiniMe Search',
    free: 'Yes, always',
    pro:  'Yes — ranked above free shops',
  },
  {
    label: 'Products you can list',
    free: `Up to ${FREE_LIMITS.products}`,
    pro:  'Unlimited',
  },
  {
    label: 'Secretary (replies as you, from your own Telegram)',
    free: `${FREE_LIMITS.secretaryRepliesPerMonth} messages/month`,
    pro:  'Unlimited',
  },
  {
    label: 'Advisor — business advice on demand',
    free: null,
    pro:  'Included',
  },
  {
    label: 'Broadcast to all your customers',
    free: null,
    pro:  'Included',
  },
  {
    label: 'Market insights — what buyers want that nobody stocks',
    free: null,
    pro:  'Included',
  },
  {
    label: 'Support',
    free: 'Standard',
    pro:  'Priority',
  },
];

/** Single-column views, derived so the two can never drift out of sync. */
export const FREE_BENEFITS = PLAN_COMPARISON
  .filter(r => r.free)
  .map(r => `${r.label}: ${r.free}`);

export const PRO_BENEFITS = PLAN_COMPARISON
  .map(r => `${r.label}: ${r.pro}`);

/**
 * Resolve a business's plan state. Trial (not yet expired) counts as Pro so the
 * owner experiences the full product first.
 */
export function planStatus(business) {
  if (!business) return { isPro: false, onTrial: false, trialDaysLeft: 0, tier: 'free', status: 'free', expired: false };
  const tier    = business.plan_tier || business.subscription_plan || 'free';
  const status  = business.subscription_status || 'trial';
  const now     = Date.now();
  const trialEnds = business.trial_ends_at ? new Date(business.trial_ends_at).getTime() : 0;
  const expiresAt = business.subscription_expires_at ? new Date(business.subscription_expires_at).getTime() : 0;

  // A payment waiting for review (pending_review) keeps the access the owner
  // already had — a trial or an unexpired subscription — until it's decided.
  // Without this, paying for 3 months mid-trial switched Pro off while waiting.
  const reviewing = status === 'pending_review';
  const activeSub = (status === 'active' || reviewing) && expiresAt > now;
  const onTrial   = (status === 'trial' || reviewing) && trialEnds > now;
  // Existing no-expiry Pro grants remain valid. A finite subscription must
  // obey its expiry even when an old payment path left plan_tier='pro'.
  const legacyGrant = tier === 'pro' && !business.subscription_expires_at && !['cancelled', 'expired'].includes(status);
  const isPro     = legacyGrant || activeSub || onTrial;
  const trialDaysLeft = onTrial ? Math.max(0, Math.ceil((trialEnds - now) / 86400000)) : 0;
  const expired   = !isPro && (status === 'expired' || status === 'cancelled' || (expiresAt > 0 && expiresAt <= now) || ((status === 'trial' || reviewing) && trialEnds > 0 && trialEnds <= now));

  return { isPro, onTrial, trialDaysLeft, tier, status, activeSub, expired };
}

export function isProBusiness(business) {
  return planStatus(business).isPro;
}
