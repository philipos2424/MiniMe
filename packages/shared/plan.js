/**
 * Canonical plan / pricing facts (CJS — for the bot and any Node worker).
 *
 * MiniMe sells ONE paid plan: Pro, 1,999 ETB/month. The free tier is
 * FEATURE-gated, never usage-capped — a free shop's core value (MiniMe
 * answering customers) is never blocked.
 *
 * apps/web mirrors this in src/lib/plan.js (ESM) rather than importing it,
 * matching how constants.js/crypto.js are mirrored for Vercel bundling.
 * If you change the price or the feature list here, change it there too.
 */

const PRO_PRICE_ETB = 1999;
const PRO_PRICE_ANNUAL_ETB = 19990; // 12 months for the price of 10
const PRO_PRICE_LABEL = `${PRO_PRICE_ETB.toLocaleString('en-US')} ETB/month`;

const FREE_LIMITS = {
  products: 30,
  secretaryRepliesPerMonth: 100,
};

// The features Pro unlocks. Keys match apps/web/src/lib/plan.js PRO_FEATURES.
const PRO_FEATURE_LABELS = [
  '🚀 *MiniMe sends replies himself* — nights, Sundays, while you serve walk-ins',
  '✨ Advisor — business advice on demand',
  '📢 Broadcast — message all customers at once',
  `🤝 Unlimited secretary replies (Free: ${FREE_LIMITS.secretaryRepliesPerMonth}/month)`,
  '🔎 Market insights — what shoppers want that you don\'t stock',
  '🔝 Top of MiniMe Search — above the free shops',
  `📦 Unlimited products (Free: ${FREE_LIMITS.products})`,
];

// What a Free shop gets, forever. Nothing here ever switches off.
const FREE_FEATURE_LABELS = [
  'MiniMe writes every reply — unlimited',
  'You tap send',
  'Listed on MiniMe Search',
  `Secretary — ${FREE_LIMITS.secretaryRepliesPerMonth} replies/month`,
  `Up to ${FREE_LIMITS.products} products`,
  'Basic analytics',
];

/**
 * Resolve a business's plan state. An unexpired trial counts as Pro — the
 * whole point of the free month is full access before the ask.
 *
 * Mirrors apps/web/src/lib/plan.js planStatus() and
 * apps/web/src/lib/server/planGuard.js planStatusServer(); the three must not
 * drift into disagreeing about who is Pro.
 */
function planStatus(business) {
  if (!business) {
    return { isPro: false, onTrial: false, trialDaysLeft: 0, tier: 'free', status: 'free', expired: false };
  }
  const tier      = business.plan_tier || business.subscription_plan || 'free';
  const status    = business.subscription_status || 'trial';
  const now       = Date.now();
  const trialEnds = business.trial_ends_at ? new Date(business.trial_ends_at).getTime() : 0;
  const expiresAt = business.subscription_expires_at ? new Date(business.subscription_expires_at).getTime() : 0;

  const activeSub = status === 'active' && (!expiresAt || expiresAt > now);
  const onTrial   = status === 'trial' && trialEnds > now;
  const isPro     = tier === 'pro' || activeSub || onTrial;
  const trialDaysLeft = onTrial ? Math.max(0, Math.ceil((trialEnds - now) / 86400000)) : 0;
  const expired   = !isPro && (status === 'expired' || status === 'cancelled' || (status === 'trial' && trialEnds && trialEnds <= now));

  return { isPro, onTrial, trialDaysLeft, tier, status, activeSub, expired };
}

function isProBusiness(business) {
  return planStatus(business).isPro;
}

// ── The autonomy line ────────────────────────────────────────────────────────
// Free  — MiniMe writes the reply, the owner taps send.
// Pro   — MiniMe sends it himself.
// Every customer still gets answered on Free; what Pro buys is not having to
// be there. Mirrors apps/web/src/lib/plan.js.
//
// Must equal TRUST_LEVELS.SUPERVISED in ./constants.js.
const FREE_MAX_TRUST_LEVEL = 1;

/**
 * Trust level this business may actually operate at. Caps at READ time and
 * never writes the row, so the owner's chosen level survives a lapse and comes
 * back the instant they upgrade.
 */
function effectiveTrustLevel(business) {
  const stored = Number(business?.trust_level ?? FREE_MAX_TRUST_LEVEL);
  if (planStatus(business).isPro) return stored;
  return Math.min(stored, FREE_MAX_TRUST_LEVEL);
}

function isTrustLevelCapped(business) {
  return Number(business?.trust_level ?? 0) > effectiveTrustLevel(business);
}

module.exports = {
  PRO_PRICE_ETB,
  PRO_PRICE_ANNUAL_ETB,
  PRO_PRICE_LABEL,
  PRO_FEATURE_LABELS,
  FREE_FEATURE_LABELS,
  FREE_LIMITS,
  FREE_MAX_TRUST_LEVEL,
  planStatus,
  isProBusiness,
  effectiveTrustLevel,
  isTrustLevelCapped,
};
