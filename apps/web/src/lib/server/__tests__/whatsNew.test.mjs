import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE, SHOW_DAYS, isWhatsNewVisible } from '../../whatsNew.mjs';

const DAY = 24 * 60 * 60 * 1000;
const shipped = Date.parse(`${RELEASE.date}T00:00:00Z`);

test('visible to an owner who signed up before the release and has not dismissed it', () => {
  assert.equal(isWhatsNewVisible({ businessCreatedAt: '2026-09-01T10:00:00Z', now: shipped + DAY }), true);
});

test('hidden once the owner dismissed this release id', () => {
  assert.equal(isWhatsNewVisible({ dismissedId: RELEASE.id, businessCreatedAt: '2026-09-01T10:00:00Z', now: shipped + DAY }), false);
});

test('a dismissal of an older release does not hide the current one', () => {
  assert.equal(isWhatsNewVisible({ dismissedId: 'whats-new-2026-01', businessCreatedAt: '2026-09-01T10:00:00Z', now: shipped + DAY }), true);
});

test('hidden for shops created after the release shipped: nothing changed for them', () => {
  assert.equal(isWhatsNewVisible({ businessCreatedAt: '2026-10-25T08:00:00Z', now: shipped + 2 * DAY }), false);
});

test('shown when the shop has no created_at yet (business still loading is handled by the caller)', () => {
  assert.equal(isWhatsNewVisible({ businessCreatedAt: null, now: shipped + DAY }), true);
});

test('expires after SHOW_DAYS', () => {
  assert.equal(isWhatsNewVisible({ businessCreatedAt: '2026-09-01T10:00:00Z', now: shipped + (SHOW_DAYS - 1) * DAY }), true);
  assert.equal(isWhatsNewVisible({ businessCreatedAt: '2026-09-01T10:00:00Z', now: shipped + (SHOW_DAYS + 1) * DAY }), false);
});

test('a release with no items or no id never renders', () => {
  assert.equal(isWhatsNewVisible({ release: { id: 'x', date: RELEASE.date, items: [] }, now: shipped + DAY }), false);
  assert.equal(isWhatsNewVisible({ release: { date: RELEASE.date, items: RELEASE.items }, now: shipped + DAY }), false);
});

test('release items each carry a title and text, and links stay in-app', () => {
  for (const it of RELEASE.items) {
    assert.ok(it.title && it.text);
    if (it.href) assert.ok(it.href.startsWith('/') && it.cta);
  }
});
