/**
 * Centralized SaaS Billing & Credit Service
 * Supports multi-tiered subscription plans, credit decrementing,
 * zero-credit guards (HTTP 402), multi-payment providers, usage logging,
 * admin subscription controls, and future strategy extensions.
 */
import { supabase } from './db.js';
import { SUBSCRIPTION_PLANS, PURCHASABLE_PLANS, planPriceEtb } from '../plan.js';

// ── Subscription Plan Definitions ───────────────────────────────────────────
//
// The catalog itself lives in lib/plan.js so client components can render
// prices without importing this (service-role) module. Re-exported here so the
// existing `from 'lib/server/billing'` import sites keep working.
//
// Entitlements are a separate concern: lib/plan.js planStatus() on the client,
// lib/server/planGuard.js on the server. This table is only about what you buy.
export { SUBSCRIPTION_PLANS, PURCHASABLE_PLANS, planPriceEtb };

// ── Extensible Strategy Architecture ───────────────────────────────────────
class CreditStrategy {
  checkAccess(sub) {
    if (!sub || sub.status !== 'active') {
      return { allowed: false, error: 'Subscription is inactive or suspended.' };
    }
    // Capped credits (e.g., 15, 50, 100) vs Unlimited (-1)
    if (sub.credits_remaining === -1) {
      return { allowed: true, remaining: -1, unlimited: true };
    }
    if (sub.credits_remaining <= 0) {
      return { allowed: false, error: 'No AI credits remaining.', remaining: 0 };
    }
    return { allowed: true, remaining: sub.credits_remaining, unlimited: false };
  }
}

class TokenLimitStrategy {
  checkAccess(sub) {
    if (!sub || sub.status !== 'active') return { allowed: false, error: 'Subscription is inactive.' };
    return { allowed: true, remaining: sub.credits_remaining, unlimited: false };
  }
}

class UnlimitedStrategy {
  checkAccess(sub) {
    return { allowed: true, remaining: -1, unlimited: true };
  }
}

const STRATEGIES = {
  credits: new CreditStrategy(),
  tokens: new TokenLimitStrategy(),
  unlimited: new UnlimitedStrategy(),
};

let currentStrategyMode = 'credits';

export function setBillingStrategy(mode) {
  if (STRATEGIES[mode]) currentStrategyMode = mode;
}

export function getActiveBillingStrategy() {
  return STRATEGIES[currentStrategyMode] || STRATEGIES.credits;
}

// ── Core Service Methods ───────────────────────────────────────────────────

/**
 * Get or initialize subscription for a business.
 */
export async function getSubscription(businessId) {
  if (!businessId) return null;
  const sb = supabase();

  try {
    const { data: existing, error } = await sb
      .from('subscriptions')
      .select('*')
      .eq('user_id', businessId)
      .maybeSingle();

    if (existing) return existing;

    // Create default Free Plan subscription (15 credits)
    const freePlan = SUBSCRIPTION_PLANS.free;
    const newSub = {
      user_id: businessId,
      plan_name: freePlan.id,
      credits_total: freePlan.chats,
      credits_used: 0,
      credits_remaining: freePlan.chats,
      status: 'active',
      started_at: new Date().toISOString(),
      expires_at: null,
      payment_reference: 'initial_free',
    };

    const { data: created, error: createErr } = await sb
      .from('subscriptions')
      .insert(newSub)
      .select()
      .single();

    if (createErr) {
      console.warn('[billing] Failed to insert free sub, falling back to virtual sub:', createErr.message);
      return newSub;
    }

    return created;
  } catch (e) {
    console.warn('[billing] getSubscription error:', e.message);
    // Fail OPEN. Free is not usage-capped, so a DB blip must never be the
    // reason MiniMe stops answering a shop's customers.
    return {
      user_id: businessId,
      plan_name: 'free',
      credits_total: -1,
      credits_used: 0,
      credits_remaining: -1,
      status: 'active',
    };
  }
}

/**
 * Check if business has available credits prior to invoking Claude API.
 */
export async function checkCreditAvailability(businessId) {
  const sub = await getSubscription(businessId);
  const strategy = getActiveBillingStrategy();
  return {
    ...strategy.checkAccess(sub),
    subscription: sub,
  };
}

// ── Credit weighting ────────────────────────────────────────────────────────
//
// A credit used to mean "one API call", regardless of size. That made a 40-token
// intent classification cost the same as a 4,000-token reply with a full
// knowledge-base prompt — a ~100x spread billed identically. Businesses with
// long conversations were subsidised by businesses with short ones, and no
// amount of prompt tuning changed what anyone was charged.
//
// One credit now buys CREDIT_TOKEN_UNIT tokens, minimum one credit per call so
// a flood of tiny calls still costs something. Keep this in sync with the plan
// credit allowances in lib/plan.js — raising the unit silently makes every plan
// more generous.
const CREDIT_TOKEN_UNIT = 1000;

export function creditsForTokens(tokensUsed) {
  return Math.max(1, Math.ceil((tokensUsed || 0) / CREDIT_TOKEN_UNIT));
}

/**
 * Decrement remaining credits (weighted by tokens used) and record usage in the
 * ai_usage history table.
 */
export async function deductCreditAndLogUsage(businessId, conversationId = null, tokensUsed = 0, costEstimate = 0) {
  if (!businessId) return { success: false, error: 'No businessId provided' };
  const sb = supabase();

  const sub = await getSubscription(businessId);
  const strategy = getActiveBillingStrategy();
  const access = strategy.checkAccess(sub);

  if (!access.allowed) {
    return { success: false, error: access.error, remaining: 0 };
  }

  try {
    const cost = creditsForTokens(tokensUsed);
    let newRemaining = sub.credits_remaining;
    let newUsed = (sub.credits_used || 0) + cost;

    // If not unlimited (-1), decrement credits_remaining. Clamp at 0 — a single
    // large call must not push the balance negative, which would read as
    // "unlimited" nowhere but would break the >0 checks in checkAccess.
    if (sub.credits_remaining > 0) {
      newRemaining = Math.max(0, sub.credits_remaining - cost);
    }

    // Update subscriptions table
    await sb
      .from('subscriptions')
      .update({
        credits_used: newUsed,
        credits_remaining: newRemaining,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', businessId);

    // Synchronize business table plan details
    await sb
      .from('businesses')
      .update({
        plan_tier: sub.plan_name,
        subscription_status: sub.status,
      })
      .eq('id', businessId);

    // Save usage history in ai_usage table
    await sb
      .from('ai_usage')
      .insert({
        user_id: businessId,
        conversation_id: conversationId || null,
        tokens_used: tokensUsed || 0,
        cost_estimate: costEstimate || 0,
      });

    return {
      success: true,
      credits_remaining: newRemaining,
      credits_used: newUsed,
      unlimited: sub.credits_remaining === -1,
    };
  } catch (e) {
    console.error('[billing] deductCreditAndLogUsage failed:', e.message);
    // Non-blocking fallback
    return { success: true, credits_remaining: Math.max(0, (sub?.credits_remaining || 1) - 1) };
  }
}

/**
 * Upgrade business subscription after successful payment.
 */
export async function upgradeSubscription(businessId, { planName, paymentReference, paymentMethod = 'card', durationMonths = 1 }) {
  if (!businessId) throw new Error('Missing businessId');
  // NB: the old fallback here was SUBSCRIPTION_PLANS.starter, which has never
  // existed — an unknown plan name threw on `planDef.chats` instead of
  // degrading. Pro is the only plan a new upgrade can mean.
  const planDef = SUBSCRIPTION_PLANS[String(planName || '').toLowerCase()] || SUBSCRIPTION_PLANS.pro;
  const sb = supabase();

  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + durationMonths);

  const totalCredits = planDef.chats;
  const subData = {
    plan_name: planDef.id,
    credits_total: totalCredits,
    credits_used: 0,
    credits_remaining: totalCredits,
    status: 'active',
    started_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    payment_reference: paymentReference || `${paymentMethod}-${Date.now()}`,
    updated_at: now.toISOString(),
  };

  const { data: updatedSub, error: subErr } = await sb
    .from('subscriptions')
    .upsert({ user_id: businessId, ...subData }, { onConflict: 'user_id' })
    .select()
    .single();

  if (subErr) {
    console.error('[billing] upgradeSubscription DB error:', subErr.message);
    throw subErr;
  }

  // Update businesses table status and plan_tier
  await sb
    .from('businesses')
    .update({
      subscription_status: 'active',
      plan_tier: planDef.id,
      subscription_plan: planDef.id,
      subscription_expires_at: expiresAt.toISOString(),
      payment_ref: paymentReference,
      payment_notes: `Upgraded to ${planDef.name} via ${paymentMethod} on ${now.toISOString()}`,
    })
    .eq('id', businessId);

  // Log payment record in payments table. Ethiopian rails (Chapa, Telebirr,
  // CBE) actually charge ETB — recording those as USD understated revenue by
  // ~150x in the admin analytics roll-up.
  const etbMethods = ['chapa', 'telebirr', 'telebirr_manual', 'cbe', 'cbe_birr', 'cbe_manual'];
  const chargedEtb = etbMethods.includes(paymentMethod);

  await sb.from('payments').insert({
    business_id: businessId,
    amount: chargedEtb ? planPriceEtb(planDef, durationMonths) : (planDef.priceMonthlyUsd || 0) * durationMonths,
    currency: chargedEtb ? 'ETB' : 'USD',
    method: paymentMethod,
    status: 'completed',
    direction: 'inbound',
    reference: paymentReference,
    description: `Subscription Upgrade to ${planDef.name}`,
    completed_at: now.toISOString(),
  });

  return updatedSub;
}

/**
 * Admin Subscription Control Actions (give extra credits, reset credits, suspend/activate).
 */
export async function adminManageSubscription(businessId, { action, extraCredits = 0, resetCredits = null, suspend = false }) {
  if (!businessId) throw new Error('Missing businessId');
  const sb = supabase();
  const sub = await getSubscription(businessId);

  let updatePayload = { updated_at: new Date().toISOString() };

  if (action === 'add_credits') {
    if (sub.credits_remaining !== -1) {
      updatePayload.credits_remaining = (sub.credits_remaining || 0) + Number(extraCredits);
      updatePayload.credits_total = (sub.credits_total || 0) + Number(extraCredits);
    }
  } else if (action === 'reset_credits') {
    const planDef = SUBSCRIPTION_PLANS[sub.plan_name] || SUBSCRIPTION_PLANS.free;
    const target = resetCredits !== null ? Number(resetCredits) : planDef.chats;
    updatePayload.credits_remaining = target;
    updatePayload.credits_total = target;
    updatePayload.credits_used = 0;
  } else if (action === 'suspend') {
    updatePayload.status = suspend ? 'suspended' : 'active';
  }

  const { data: updated, error } = await sb
    .from('subscriptions')
    .update(updatePayload)
    .eq('user_id', businessId)
    .select()
    .single();

  if (error) throw error;

  if (action === 'suspend') {
    await sb.from('businesses').update({
      subscription_status: suspend ? 'cancelled' : 'active',
    }).eq('id', businessId);
  }

  return updated;
}

/**
 * Fetch detailed billing analytics & recent payments for a business.
 */
export async function getBillingOverview(businessId) {
  const sb = supabase();
  const sub = await getSubscription(businessId);

  // Fetch recent payments
  const { data: payments } = await sb
    .from('payments')
    .select('*')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })
    .limit(10);

  // Fetch usage stats for this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: usageLogs } = await sb
    .from('ai_usage')
    .select('tokens_used, cost_estimate, created_at')
    .eq('user_id', businessId)
    .gte('created_at', startOfMonth.toISOString());

  const monthRequests = usageLogs?.length || 0;
  const monthTokens = (usageLogs || []).reduce((acc, row) => acc + (row.tokens_used || 0), 0);
  const monthCost = (usageLogs || []).reduce((acc, row) => acc + Number(row.cost_estimate || 0), 0);

  return {
    subscription: sub,
    plan: SUBSCRIPTION_PLANS[sub.plan_name] || SUBSCRIPTION_PLANS.free,
    usageThisMonth: {
      requests: monthRequests,
      tokens: monthTokens,
      costEstimateUsd: monthCost,
    },
    recentPayments: payments || [],
  };
}

/**
 * Admin-level analytics across all users/subscriptions.
 */
export async function getAdminBillingAnalytics() {
  const sb = supabase();

  const { data: subscriptions } = await sb
    .from('subscriptions')
    .select('*, businesses(name, owner_name, email)');

  const { data: usageLogs } = await sb
    .from('ai_usage')
    .select('tokens_used, cost_estimate');

  const { data: payments } = await sb
    .from('payments')
    .select('amount, status, created_at')
    .eq('status', 'completed');

  const totalClaudeUsage = (usageLogs || []).length;
  const totalTokens = (usageLogs || []).reduce((sum, r) => sum + (r.tokens_used || 0), 0);
  const totalClaudeCost = (usageLogs || []).reduce((sum, r) => sum + Number(r.cost_estimate || 0), 0);
  const totalRevenue = (payments || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return {
    subscriptions: subscriptions || [],
    totalClaudeUsage,
    totalTokens,
    totalClaudeCost,
    totalRevenue,
  };
}
