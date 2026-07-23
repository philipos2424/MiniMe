'use client';
/**
 * Fires a single market_events view row for a public page (shop storefront or
 * directory profile) after mount. Client-only + sessionStorage-deduped so it
 * counts real human visits: SSR/crawlers never run it, and refresh/back-nav in
 * the same tab won't double-count. Fire-and-forget — telemetry never blocks UI.
 */
import { useEffect } from 'react';

export default function ViewBeacon({ eventType = 'view_shop', businessId }) {
  useEffect(() => {
    if (!businessId) return;
    const key = `mm_view_${eventType}_${businessId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* private mode — fall through and still beacon once */ }

    const body = JSON.stringify({ event_type: eventType, business_id: businessId });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/market/event', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/market/event', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true,
        }).catch(() => {});
      }
    } catch { /* ignore */ }
  }, [eventType, businessId]);

  return null;
}
