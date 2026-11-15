'use client';
import { useEffect } from 'react';

/**
 * Makes room for the hosting platform's badge.
 *
 * Netlify's free plan pins a "Powered by Netlify" badge to the bottom-right of
 * every page, on top of everything (it is injected after </html>, in an iframe
 * with the highest z-index). It is part of that plan and cannot be dismissed,
 * so it sat on the Progress and Settings tabs of the bottom navigation, on the
 * send button of the chat composer, and on the market's tab bar.
 *
 * This does not hide the badge. It marks the page when the badge is there, and
 * globals.css lifts the app's bottom edge clear of it (--host-badge-space). On
 * a paid plan, on Vercel or on a VPS nothing is injected and nothing changes.
 */
export default function HostBadgeSpace() {
  useEffect(() => {
    const badge = document.querySelector('script[data-nf-variant="public"][data-account-tier="free"]');
    if (badge) document.documentElement.dataset.hostBadge = '1';
  }, []);
  return null;
}
