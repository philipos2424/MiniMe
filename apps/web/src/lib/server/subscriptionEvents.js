/**
 * Subscription history logging — fire-and-forget, never throws, never blocks
 * the payment/admin flow that triggered it. Feeds /api/admin/economics real
 * churn and trial→paid numbers instead of the businesses.updated_at
 * approximation (see supabase/migrations/subscription_events.sql).
 */
import { supabase } from './db';

export function logSubscriptionEvent({ businessId, event, plan = null, amountEtb = null, meta = null }) {
  if (!businessId || !event) return;
  supabase().from('subscription_events').insert({
    business_id: businessId,
    event,
    plan,
    amount_etb: amountEtb,
    meta,
  }).then(() => {}, e => console.warn('[subscription-events] insert failed:', e.message));
}
