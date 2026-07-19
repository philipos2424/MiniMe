'use client';
import { useEffect } from 'react';

/**
 * Fires a one-shot marketplace event from an otherwise-SSR page.
 *
 * The public shop profile (/directory/[username]) is a server component, so it
 * can't POST telemetry itself. Dropping this in gives owners visibility of web
 * shoppers in their Analytics "MiniMe Market" panel, matching what the Market
 * Mini App already reports. Same contract as app/market/lib.js logEvent.
 */
function send(event_type, businessId) {
  try {
    const body = JSON.stringify({
      event_type, business_id: businessId, meta: { via: 'directory' },
    });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon('/api/market/event', new Blob([body], { type: 'application/json' }));
      return;
    }
    fetch('/api/market/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body, keepalive: true,
    }).catch(() => {});
  } catch { /* telemetry must never break the page */ }
}

export function ViewTracker({ businessId, eventType = 'view_shop' }) {
  useEffect(() => {
    if (!businessId) return;
    // StrictMode double-invokes effects in dev; the endpoint is rate-limited and
    // this is directional analytics, so a rare duplicate is acceptable.
    send(eventType, businessId);
  }, [businessId, eventType]);

  // The page has several "Chat on Telegram" CTAs and is server-rendered, so we
  // can't hang onClick on each. One delegated listener catches them all —
  // click_chat is the highest-intent signal a shop gets from the web directory.
  useEffect(() => {
    if (!businessId) return;
    function onClick(e) {
      const a = e.target?.closest?.('a[href*="t.me/"]');
      if (a) send('click_chat', businessId);
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [businessId]);

  return null;
}
