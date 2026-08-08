'use client';
/**
 * Global behavioural capture — mount once per surface.
 *
 * One delegated, capture-phase click listener on `document` covers every
 * clickable element on every screen. That is the whole point: the Mini App is
 * ~50 screens (25 top-level + 23 settings subpages + the 5-tab bottom nav), and
 * instrumenting them one by one would mean ~50 edits that go stale the moment
 * someone adds a screen. Delegation gives complete raw coverage on day one;
 * `data-intent` attributes then layer SEMANTICS on top, incrementally.
 *
 * The same pattern already exists in app/directory/ViewTracker.jsx, hardcoded
 * to `a[href*="t.me/"]`. This is that idea, generalised.
 *
 * Capture phase (not bubble) so we still record clicks on handlers that call
 * stopPropagation() — several dropdowns and sheets in the dashboard do.
 */
import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { configureTracking, track, flush } from '../lib/track';
import { useTelegramOptional } from '../context/TelegramContext';

const UUID_SEG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEG = /^\d+$/;
// Anything that looks like a code/slug rather than a route name. Shop codes and
// invite codes appear in paths and are effectively identifiers.
const CODEY_SEG = /^[A-Za-z0-9_-]{16,}$/;
// Segments whose CHILD is always an identifier, recognised by POSITION rather
// than by shape. /shop/[code] and /directory/[username] carry short, wordlike
// slugs ("kaldis") that no shape rule can tell apart from a real route name —
// and getting it wrong means every storefront becomes its own feature row.
// Value = that parent's real static children, which must NOT be collapsed
// (/directory/qr is a page, not a storefront).
const ID_PARENTS = new Map([
  ['shop', new Set()],
  ['directory', new Set(['qr'])],
]);

/**
 * Collapse identifiers out of a pathname so routes aggregate:
 *   /conversations/9f2c…  ->  /conversations/[id]
 *   /shop/kaldis          ->  /shop/[id]
 * Without this every conversation is its own "feature" and the usage ranking is
 * meaningless.
 */
export function normalizeRoute(pathname) {
  if (!pathname) return '/';
  const segs = pathname.split('/').filter(Boolean);
  return (
    '/' +
    segs
      .map((seg, i) => {
        const statics = i > 0 ? ID_PARENTS.get(segs[i - 1]) : undefined;
        if (statics && !statics.has(seg)) return '[id]';
        return UUID_SEG.test(seg) || NUMERIC_SEG.test(seg) || CODEY_SEG.test(seg) ? '[id]' : seg;
      })
      .join('/')
  );
}

/**
 * A structural descriptor of the clicked element.
 *
 * Explicitly NOT textContent. On conversations/, customers/ and orders/ the
 * visible text is customer names, phone numbers and message bodies — capturing
 * it would move real customer PII into an analytics table, which
 * docs/DATA_RETENTION.md does not permit. Tag, id and class names are authored
 * by us and carry no user data.
 */
export function describeTarget(el) {
  if (!el || !el.tagName) return null;
  if (el.dataset?.trackId) return String(el.dataset.trackId).slice(0, 120);
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls =
    typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
  return `${tag}${id}${cls}`.slice(0, 120);
}

/** Nearest meaningful ancestor: an annotated element, or a real control. */
function findTarget(start) {
  let el = start;
  for (let i = 0; el && i < 8; i++) {
    if (el.nodeType === 1) {
      if (el.dataset?.intent) return el;
      const tag = el.tagName?.toLowerCase();
      if (tag === 'button' || tag === 'a' || el.getAttribute?.('role') === 'button') return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Public surfaces (Market/Shop/Directory) have no TelegramProvider — they read
 * window.Telegram directly, same as app/market/lib.js `tgUserId()`. Falling back
 * to it here means those events are still attributable to a Telegram user
 * without threading identity props through every public page.
 */
function ambientTgUserId() {
  try {
    return String(window?.Telegram?.WebApp?.initDataUnsafe?.user?.id || '') || null;
  } catch {
    return null;
  }
}

export default function Tracker({ surface = 'dashboard', businessId = null }) {
  const pathname = usePathname();
  const tg = useTelegramOptional();
  // Read through a ref inside the listener so identity arriving late (Telegram
  // auth resolves ~1s after mount) doesn't require re-binding the listener.
  const routeRef = useRef(normalizeRoute(pathname));
  const enteredAtRef = useRef(Date.now());

  useEffect(() => {
    configureTracking({
      surface,
      initData: tg?.initData || null,
      businessId: tg?.business?.id || businessId || null,
      tgUserId: tg?.telegramUser?.id ? String(tg.telegramUser.id) : ambientTgUserId(),
    });
  }, [surface, businessId, tg?.initData, tg?.business?.id, tg?.telegramUser?.id]);

  // Delegated click capture — bound once for the life of the surface.
  useEffect(() => {
    function onClick(e) {
      try {
        const el = findTarget(e.target);
        if (!el) return;
        track('click', {
          intent: el.dataset?.intent || undefined,
          target: describeTarget(el),
          route: routeRef.current,
        });
      } catch {}
    }
    document.addEventListener('click', onClick, { capture: true });
    return () => document.removeEventListener('click', onClick, { capture: true });
  }, []);

  // Flush on hide/unload. visibilitychange is the one that actually fires in
  // Telegram's webview when the user swipes the Mini App away; pagehide covers
  // real browsers on the public surfaces.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        track('dwell', { route: routeRef.current, meta: { ms: Date.now() - enteredAtRef.current } });
        flush(true);
      }
    };
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Route change: close out the previous screen's dwell, open the new one.
  useEffect(() => {
    const next = normalizeRoute(pathname);
    const prev = routeRef.current;
    if (prev && prev !== next) {
      track('dwell', { route: prev, meta: { ms: Date.now() - enteredAtRef.current } });
    }
    routeRef.current = next;
    enteredAtRef.current = Date.now();
    track('nav', { route: next });
  }, [pathname]);

  return null;
}
