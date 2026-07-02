/**
 * referrals.js — the "give 30%, get 30%" loop.
 *
 * Lifecycle:
 *   1. Owner asks for their link → getOrCreateReferralCode() mints a code.
 *   2. Friend opens t.me/<bot>?startapp=ref_CODE (or /onboarding?ref=CODE) →
 *      signup passes the code → attachReferrer() sets businesses.referred_by.
 *   3. Friend ACTIVATES (goes live via complete-shared or bot/link) →
 *      awardReferral() writes one referral_rewards row per side (idempotent via
 *      UNIQUE(referred_business_id, side)) and DMs the referrer.
 *
 * Rewards are display-credits for now: Billing shows them; ops applies the 30%
 * when confirming the (manual/Chapa-reviewed) payment.
 */
import { supabase } from './db';
import { generateShopCode } from './businesses';

const REWARD_PERCENT = 30;

/** Mint (or return) the business's referral code. Null on schema-not-migrated. */
export async function getOrCreateReferralCode(businessId) {
  const sb = supabase();
  const { data: biz, error } = await sb
    .from('businesses').select('referral_code').eq('id', businessId).single();
  if (error) return null; // column missing (migration not run) or no row
  if (biz?.referral_code) return biz.referral_code;
  // Retry a few times in the (unlikely) event of a UNIQUE collision.
  for (let i = 0; i < 3; i++) {
    const code = generateShopCode();
    const { data, error: upErr } = await sb
      .from('businesses').update({ referral_code: code })
      .eq('id', businessId).select('referral_code').single();
    if (!upErr && data?.referral_code) return data.referral_code;
  }
  return null;
}

/**
 * Resolve a referral code to the referrer and link it to a (new) business.
 * Safe against self-referral and overwriting an existing referrer.
 */
export async function attachReferrer(businessId, referralCode) {
  const code = String(referralCode || '').trim().toLowerCase();
  if (!code || !businessId) return false;
  const sb = supabase();
  const { data: referrer } = await sb
    .from('businesses').select('id').eq('referral_code', code).maybeSingle();
  if (!referrer || referrer.id === businessId) return false;
  const { error } = await sb
    .from('businesses').update({ referred_by: referrer.id })
    .eq('id', businessId).is('referred_by', null);
  return !error;
}

/**
 * Award both sides after the referred business's FIRST activation.
 * Idempotent: UNIQUE(referred_business_id, side) rejects repeats silently.
 * Fire-and-forget from the activation routes — never blocks activation.
 */
export async function awardReferral(business, botToken) {
  try {
    if (!business?.referred_by) return;
    const sb = supabase();
    const rows = ['referred', 'referrer'].map(side => ({
      referrer_business_id: business.referred_by,
      referred_business_id: business.id,
      side,
      reward_percent: REWARD_PERCENT,
    }));
    const { error } = await sb.from('referral_rewards').insert(rows);
    if (error) return; // duplicate (already awarded) or table missing — no-op

    // Tell the referrer the good news.
    if (botToken) {
      const { data: referrer } = await sb
        .from('businesses')
        .select('owner_private_chat_id, owner_telegram_id')
        .eq('id', business.referred_by).maybeSingle();
      const chatId = referrer?.owner_private_chat_id || referrer?.owner_telegram_id;
      if (chatId) {
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            parse_mode: 'Markdown',
            text: `🎉 *${business.name || 'A friend'}* just joined MiniMe with your link!\n\nYour *${REWARD_PERCENT}% off next month* is locked in — you'll see it in Settings → Billing.`,
          }),
          signal: AbortSignal.timeout(6000),
        }).catch(() => {});
      }
    }
  } catch { /* rewards must never break activation */ }
}

/** Earned (unapplied) credits for Billing display. */
export async function listReferralCredits(businessId) {
  const sb = supabase();
  const { data, error } = await sb
    .from('referral_rewards')
    .select('id, side, reward_percent, status, created_at, referred_business_id, referrer_business_id')
    .or(`and(referrer_business_id.eq.${businessId},side.eq.referrer),and(referred_business_id.eq.${businessId},side.eq.referred)`)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return [];
  return data || [];
}
