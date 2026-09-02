/**
 * Handles are revealed automatically — that was a product decision, and it
 * means MiniMe sees nothing after the handoff. Everything here exists to make
 * that handoff survivable: an offer line so a tap costs a sentence, a
 * simultaneous heads-up so no DM arrives cold, and a report path that still
 * works after the two of them have left for Telegram DMs.
 *
 * The no-username case is not an edge case. A Telegram account without an
 * @handle cannot be messaged at all, so revealing one produces a dead end that
 * looks like a bug to both people.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revealText, recordInterest, recordReport } from '../swap/swapInterest.mjs';
import { REPORTS_TO_HIDE } from '../swap/constants.mjs';

const ITEM = {
  id: 'i1', title: 'Redmi Note 10', wants_text: 'winter jacket',
  telegram_user_id: 42, telegram_username: 'meron_x', chat_id: 42, lang: 'en',
};

/**
 * Supabase fake covering just the shapes this module uses:
 * select().eq().maybeSingle(), insert(), and select(count).eq().
 */
function fakeSb({ item = ITEM, interests = [], reports = [] } = {}) {
  const state = { interests: [...interests], reports: [...reports] };
  return {
    state,
    from(table) {
      if (table === 'swap_items') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: item, error: null }) }) }),
          update: (patch) => ({ eq: async () => { Object.assign(state, { patch }); return { error: null }; } }),
        };
      }
      if (table === 'swap_interests') {
        return {
          insert: async (row) => {
            const dupe = state.interests.some(i =>
              i.swap_item_id === row.swap_item_id && i.from_telegram_user_id === row.from_telegram_user_id);
            if (dupe) return { error: { code: '23505', message: 'duplicate key' } };
            state.interests.push(row);
            return { error: null };
          },
        };
      }
      if (table === 'swap_reports') {
        return {
          insert: async (row) => { state.reports.push(row); return { error: null }; },
          select: () => ({ eq: async () => ({ count: state.reports.length, error: null }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

test('the seeker gets the handle and the lister is told at the same moment', () => {
  const { toSeeker, toLister } = revealText({
    item: ITEM, offerText: 'Nikon D3100, works fine', fromUsername: 'dawit_t', lang: 'en',
  });
  assert.match(toSeeker, /@meron_x/);
  assert.match(toLister, /@dawit_t/);
  assert.match(toLister, /Nikon D3100/, 'the lister sees what is being offered, not just that someone tapped');
  assert.match(toLister, /Redmi Note 10/);
});

test('an interest is recorded with its offer line', async () => {
  const sb = fakeSb();
  const r = await recordInterest(sb, { itemId: 'i1', fromUserId: 7, fromUsername: 'dawit_t', offerText: 'Nikon D3100' });
  assert.equal(r.ok, true);
  assert.equal(sb.state.interests[0].offer_text, 'Nikon D3100');
});

test('you cannot express interest in your own post', async () => {
  const sb = fakeSb();
  const r = await recordInterest(sb, { itemId: 'i1', fromUserId: 42, fromUsername: 'meron_x', offerText: 'x' });
  assert.equal(r.error, 'own_item');
  assert.equal(sb.state.interests.length, 0);
});

test('a lister with no @username is never revealed', async () => {
  const sb = fakeSb({ item: { ...ITEM, telegram_username: null } });
  const r = await recordInterest(sb, { itemId: 'i1', fromUserId: 7, fromUsername: 'dawit_t', offerText: 'x' });
  assert.equal(r.error, 'no_username');
});

test('tapping the same item twice is not counted twice', async () => {
  const sb = fakeSb();
  await recordInterest(sb, { itemId: 'i1', fromUserId: 7, fromUsername: 'd', offerText: 'x' });
  const again = await recordInterest(sb, { itemId: 'i1', fromUserId: 7, fromUsername: 'd', offerText: 'y' });
  assert.equal(again.error, 'duplicate');
  assert.equal(sb.state.interests.length, 1);
});

test('a missing or expired item fails closed', async () => {
  const sb = fakeSb({ item: null });
  const r = await recordInterest(sb, { itemId: 'gone', fromUserId: 7, fromUsername: 'd', offerText: 'x' });
  assert.equal(r.error, 'not_found');
});

test('reports below the threshold record but do not hide', async () => {
  const sb = fakeSb();
  const r = await recordReport(sb, { itemId: 'i1', reporterUserId: 9, reportedUserId: 42, reason: 'scam' });
  assert.equal(r.hidden, false);
  assert.equal(r.count, 1);
});

test('the threshold report hides the post', async () => {
  const existing = Array.from({ length: REPORTS_TO_HIDE - 1 }, (_, i) => ({ reporter_telegram_user_id: i }));
  const sb = fakeSb({ reports: existing });
  const r = await recordReport(sb, { itemId: 'i1', reporterUserId: 99, reportedUserId: 42, reason: 'scam' });
  assert.equal(r.count, REPORTS_TO_HIDE);
  assert.equal(r.hidden, true);
  assert.equal(sb.state.patch.status, 'hidden');
});
