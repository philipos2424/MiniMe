/**
 * Webhook delivery history — fire-and-forget logging into webhook_events.
 * Telegram's own getWebhookInfo only gives a live snapshot (pending count,
 * last error); this gives a time series so Pulse can compute a real
 * "webhook success rate" and flag dead bots from actual delivery outcomes
 * instead of a "no messages in 48h" proxy.
 */
import { supabase } from './db';

export function logWebhookEvent({ business_id = null, delivery_status, response_time_ms = null, http_status = null, error_message = null }) {
  supabase().from('webhook_events').insert({
    business_id,
    delivery_status,
    response_time_ms,
    http_status,
    error_message: error_message ? String(error_message).slice(0, 500) : null,
  }).then(() => {}, e => console.warn('[webhook_events] insert failed:', e.message));
}
