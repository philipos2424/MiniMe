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
};

export const SECRETARY_FREE_MONTHLY_CAP = FREE_LIMITS.secretaryRepliesPerMonth;

// ── The autonomy line ────────────────────────────────────────────────────────
// This is what Pro actually sells.
//
//   Free  — MiniMe reads every message and WRITES the reply. The owner taps
//           send. Nothing is gated: every customer still gets answered.
//   Pro   — MiniMe SENDS it himself. Nights, weekends, while the owner is with
//           a walk-in customer, at 2am.
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
    pitch: 'On Free, MiniMe writes every reply and you tap send. On Pro, MiniMe sends it himself — nights, Sundays, while you\'re serving someone in the shop.',
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
// MiniMe sells ONE paid plan: Pro, 1,999 ETB/month.
//
// This lives here (client-safe) rather than in lib/server/billing.js so that
// UpgradeModal and the billing page can render prices without pulling the
// service-role Supabase module into the client bundle. billing.js re-exports it.
//
// `business` / `professional` are the retired USD credit tiers, kept only so an
// existing subscriber's row still resolves to a name and price. `legacy: true`
// keeps them out of every upgrade surface — showing "$8 / 200 AI chats" next to
// "Pro / 1,999 ETB" was the biggest trust break in the funnel.
export const PRO_PRICE_ETB = 1999;
export const PRO_PRICE_ANNUAL_ETB = 19990; // 12 months for the price of 10

/** "1,999 ETB" — the one place the price is formatted for display. */
export const PRO_PRICE_LABEL = `${PRO_PRICE_ETB.toLocaleString('en-US')} ETB`;

export const SUBSCRIPTION_PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    chats: -1,
    priceMonthlyUsd: 0,
    priceMonthlyEtb: 0,
    features: [
      'MiniMe writes every reply — unlimited',
      'You tap send',
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
    priceMonthlyUsd: 14, // ≈1,999 ETB, for the Stripe/PayPal rails only
    priceMonthlyEtb: PRO_PRICE_ETB,
    features: [
      'MiniMe sends replies himself — 24/7',
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

/** Price in ETB for a plan + duration. Legacy rows fall back to the old ~150 rate. */
export function planPriceEtb(planDef, durationMonths = 1) {
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
    label: 'Who presses send',
    free: 'You do',
    pro:  'MiniMe does — 24/7',
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

  const activeSub = status === 'active' && (!expiresAt || expiresAt > now);
  const onTrial   = status === 'trial' && trialEnds > now;
  const isPro     = tier === 'pro' || activeSub || onTrial;
  const trialDaysLeft = onTrial ? Math.max(0, Math.ceil((trialEnds - now) / 86400000)) : 0;
  const expired   = !isPro && (status === 'expired' || status === 'cancelled' || (status === 'trial' && trialEnds && trialEnds <= now));

  return { isPro, onTrial, trialDaysLeft, tier, status, activeSub, expired };
}

export function isProBusiness(business) {
  return planStatus(business).isPro;
}
