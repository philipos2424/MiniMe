import { createHash } from 'node:crypto';
import { paymentReviewUpdate } from '../paymentReview.mjs';

export const paymentReviewToken = reference => createHash('sha256').update(String(reference || '')).digest('hex').slice(0, 12);

export async function reviewSubscriptionPayment(sb, { businessId, action, expectedRef, token, period, now = Date.now() }) {
  const { data: business, error } = await sb.from('businesses')
    .select('id,name,subscription_status,plan_tier,subscription_expires_at,trial_ends_at,payment_ref,payment_verified,payment_proof_url,payment_notes,verifyet_plan,owner_telegram_id,owner_private_chat_id,telegram_bot_token_enc')
    .eq('id', businessId).maybeSingle();
  if (error) throw new Error('Could not load payment. Please retry.');
  if (!business) throw new Error('Payment not found');
  if ((!expectedRef && !token) || (expectedRef && expectedRef !== business.payment_ref) || (token && token !== paymentReviewToken(business.payment_ref))) {
    throw new Error('Payment changed. Refresh the dashboard and review the current submission.');
  }
  const decision = paymentReviewUpdate(business, action, period, now);
  let query = sb.from('businesses').update(decision.updates).eq('id', businessId);
  // Compare the state used to calculate the expiry: concurrent reviewers or
  // a gateway callback must not overwrite each other or extend a payment twice.
  for (const key of ['payment_ref', 'subscription_status', 'plan_tier', 'trial_ends_at', 'payment_verified', 'payment_proof_url', 'subscription_expires_at', 'payment_notes', 'verifyet_plan']) {
    query = business[key] == null ? query.is(key, null) : query.eq(key, business[key]);
  }
  const { data: saved, error: writeError } = await query.select().maybeSingle();
  if (writeError) throw new Error('Could not save payment decision. Please retry.');
  if (!saved) throw new Error('Payment changed. Refresh the dashboard before reviewing again.');
  return { business: saved, period: decision.period, prior_status: business.subscription_status };
}
