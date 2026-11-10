/**
 * Live funnel event write — fire-and-forget, never throws, never blocks the
 * flow that triggered it. Most funnel events are derived by the weekly sync
 * (funnel/sync.js); this exists for moments no table records a time for.
 * The unique key makes a repeat call a no-op.
 */
import { supabase } from '../db';
import { funnelTrackingEnabled } from './sync';

export function recordFunnelEvent({ businessId, event, occurredAt = null, dedupeKey = '', metadata = {} }) {
  if (!businessId || !event) return;
  funnelTrackingEnabled()
    .then(on => {
      if (!on) return null;
      return supabase().from('funnel_events').upsert({
        business_id: businessId,
        event,
        occurred_at: occurredAt || new Date().toISOString(),
        dedupe_key: dedupeKey || '',
        metadata,
        source: 'live',
      }, { onConflict: 'business_id,event,dedupe_key', ignoreDuplicates: true });
    })
    .then(r => { if (r?.error) console.warn('[funnel-events] insert failed:', r.error.message); },
      e => console.warn('[funnel-events] insert failed:', e?.message));
}
