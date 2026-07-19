/**
 * Plan / entitlement helpers (client-safe, pure).
 *
 * MiniMe's free tier is FEATURE-GATED, not usage-capped: a free shop's core
 * value — MiniMe answering customers — is never blocked. Pro unlocks the power
 * features below. During the trial, everything is unlocked so owners feel the
 * full product before the ask.
 *
 * Source of truth on the business row: plan_tier ('free'|'pro'),
 * subscription_status ('trial'|'active'|'expired'|'cancelled'|'pending_review'),
 * trial_ends_at, subscription_expires_at.
 */

// The features Pro unlocks. Keys are used by <ProGate feature="…"> and the
// Settings lock badges. Copy is the paywall's value pitch — benefit-first.
export const PRO_FEATURES = {
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
  secretary: {
    label: 'Secretary mode',
    emoji: '🤝',
    pitch: 'Let MiniMe reply to customers from your own personal Telegram — as you, in your voice.',
  },
  market_insights: {
    label: 'Market insights',
    emoji: '🔎',
    pitch: 'See exactly what shoppers search for that you don\'t stock yet — and add it before your competitors.',
  },
  unlimited_products: {
    label: 'Unlimited products',
    emoji: '📦',
    pitch: 'List as many products as you sell. Free shops can list up to 30.',
  },
};

// Free-tier soft limits (never hard-block core value — these show an upgrade
// sheet, they don't break the app).
export const FREE_LIMITS = {
  products: 30,
};

// Everything Pro includes — shown in the comparison on the paywall + billing.
export const PRO_BENEFITS = [
  'MiniMe answers customers 24/7',
  'Unlimited products',
  'Advisor — business advice on demand',
  'Broadcast to all customers',
  'Secretary — reply from your own account',
  'Full analytics + Market demand insights',
  'Priority support',
];

export const FREE_BENEFITS = [
  'MiniMe answers customers 24/7',
  'Up to 30 products',
  'Basic analytics',
  'Your MiniMe Market listing',
];

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
