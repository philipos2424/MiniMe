import { test } from 'node:test';
import assert from 'node:assert/strict';

// normalizeRoute lives in a 'use client' component, so it is re-declared here
// rather than imported (importing Tracker.jsx would pull in React + next/navigation
// into a plain node:test run). Keep in sync with components/Tracker.jsx.
const UUID_SEG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEG = /^\d+$/;
const CODEY_SEG = /^[A-Za-z0-9_-]{16,}$/;
const ID_PARENTS = new Map([
  ['shop', new Set()],
  ['directory', new Set(['qr'])],
]);

function normalizeRoute(pathname) {
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

// Every route below must land on a route_pattern that exists in ux_feature_map.
// A miss doesn't error — it silently becomes its own 'Unmapped: …' row and
// fragments the usage ranking, which is exactly what this normalisation prevents.

test('collapses UUID and numeric ids', () => {
  assert.equal(normalizeRoute('/conversations/9f2c1e4a-1111-4222-8333-444455556666'), '/conversations/[id]');
  assert.equal(normalizeRoute('/orders/12345'), '/orders/[id]');
});

test('collapses short wordlike slugs under shop/ and directory/', () => {
  // The bug this guards: CODEY_SEG needs 16+ chars, so these stayed literal and
  // every storefront became its own feature.
  assert.equal(normalizeRoute('/shop/kaldis'), '/shop/[id]');
  assert.equal(normalizeRoute('/directory/abebe'), '/directory/[id]');
  assert.equal(normalizeRoute('/shop/AB12'), '/shop/[id]');
});

test('leaves real route names alone', () => {
  assert.equal(normalizeRoute('/'), '/');
  assert.equal(normalizeRoute('/settings/notifications'), '/settings/notifications');
  assert.equal(normalizeRoute('/agent/knowledge'), '/agent/knowledge');
  assert.equal(normalizeRoute('/advisor/teach'), '/advisor/teach');
  // 'directory' and 'shop' as leaves are pages in their own right, not ids.
  assert.equal(normalizeRoute('/directory'), '/directory');
  // A real static child under an id-bearing parent must survive.
  assert.equal(normalizeRoute('/directory/qr'), '/directory/qr');
});

test('still collapses long opaque codes anywhere', () => {
  assert.equal(normalizeRoute('/connect/abcdefghijklmnopqrst'), '/connect/[id]');
});
