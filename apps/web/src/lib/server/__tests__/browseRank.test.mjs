import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  browseKeywords, activityLabel, isBrowsable, orderBrowseResults,
  ACTIVE_DAYS, RECENT_DAYS,
} from '../browseRank.mjs';

const NOW = Date.parse('2026-08-17T12:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();

// A row shaped like what browseNetwork selects out of `businesses`.
const biz = (over = {}) => ({
  id: over.id || Math.random().toString(36).slice(2),
  name: 'Shop', description: '', category: null, tags: [], location: 'Addis Ababa',
  telegram_bot_username: 'shopbot', onboarding_completed: true,
  verified: false, average_rating: null, search_count: 0,
  last_active_date: daysAgo(1),
  ...over,
});

test('browseKeywords tokenizes the way the product matcher does', () => {
  // Plurals singularize so a query and the text it matches line up.
  assert.deepEqual(browseKeywords('500 flyers'), ['500', 'flyer']);
  // ...except "menus", which singularize() leaves alone: its (ss|us|is) guard
  // protects "focus"/"virus" and catches this too. Asserted so the shared
  // behavior is pinned here rather than assumed — see the note in
  // searchRanker.singularize. Changing it affects consumer search, not just
  // Browse, so it is deliberately NOT changed from here.
  assert.deepEqual(browseKeywords('send me 500 Menus'), ['send', '500', 'menus']);
  // Short words carry no signal and would match everything.
  assert.deepEqual(browseKeywords('a to go'), []);
  assert.deepEqual(browseKeywords(''), []);
  assert.deepEqual(browseKeywords(null), []);
  // Punctuation must not become part of the token.
  assert.deepEqual(browseKeywords('printing, signage!'), ['printing', 'signage']);
});

test('activityLabel buckets by how recently the shop was active', () => {
  assert.equal(activityLabel(biz({ last_active_date: daysAgo(2) }), NOW), 'week');
  assert.equal(activityLabel(biz({ last_active_date: daysAgo(ACTIVE_DAYS + 1) }), NOW), 'month');
  assert.equal(activityLabel(biz({ last_active_date: daysAgo(RECENT_DAYS + 1) }), NOW), null);
  // A shop that never recorded activity is not "dormant" — it is unknown, and
  // must not be labeled as if we measured it.
  assert.equal(activityLabel(biz({ last_active_date: null }), NOW), null);
});

test('only never-onboarded shops are excluded outright', () => {
  assert.equal(isBrowsable(biz()), true);
  assert.equal(isBrowsable(biz({ onboarding_completed: false })), false);
  // Unknown/legacy rows stay visible — absence of the flag is not proof.
  assert.equal(isBrowsable(biz({ onboarding_completed: undefined })), true);
  // Dormant is a ranking signal, never an exclusion: a real shop that has been
  // quiet for a year is still a real shop the owner may want to reach.
  assert.equal(isBrowsable(biz({ last_active_date: daysAgo(400) })), true);
});

test('an active shop outranks a dormant one when relevance is equal', () => {
  const rows = [
    biz({ id: 'dormant', name: 'Bole Printing', last_active_date: daysAgo(200) }),
    biz({ id: 'active', name: 'Bole Printing', last_active_date: daysAgo(1) }),
  ];
  const out = orderBrowseResults(rows, { keywords: ['printing'], now: NOW });
  assert.equal(out[0].id, 'active');
  assert.equal(out[0]._activity, 'week');
});

test('relevance still beats liveness — a real match is not buried by a fresh mismatch', () => {
  const rows = [
    biz({ id: 'fresh-irrelevant', name: 'Selam Catering', last_active_date: daysAgo(0) }),
    biz({ id: 'stale-match', name: 'Addis Printing House', tags: ['printing'], last_active_date: daysAgo(20) }),
  ];
  const out = orderBrowseResults(rows, { keywords: ['printing'], now: NOW });
  assert.equal(out[0].id, 'stale-match', 'the shop that actually prints must come first');
});

test('same-location shops rank above far ones, all else equal', () => {
  const rows = [
    biz({ id: 'far', name: 'Bole Printing', location: 'Hawassa' }),
    biz({ id: 'near', name: 'Bole Printing', location: 'Addis Ababa' }),
  ];
  const out = orderBrowseResults(rows, { keywords: ['printing'], near: 'Addis Ababa', now: NOW });
  assert.equal(out[0].id, 'near');
});

test('irrelevant shops are dropped for a keyword search, but never for the default view', () => {
  const rows = [
    biz({ id: 'match', name: 'Addis Printing', tags: ['printing'] }),
    biz({ id: 'nomatch', name: 'Selam Catering' }),
  ];
  const searched = orderBrowseResults(rows, { keywords: ['printing'], now: NOW });
  assert.deepEqual(searched.map(r => r.id), ['match']);

  // No query = "show me the network". Filtering on relevance here would empty
  // the tab, which is the state Browse shipped in.
  const browsed = orderBrowseResults(rows, { keywords: [], now: NOW });
  assert.equal(browsed.length, 2);
});

test('the default view leads with verified, well-rated, active shops', () => {
  const rows = [
    biz({ id: 'plain' }),
    biz({ id: 'verified', verified: true, average_rating: 4.8, search_count: 40 }),
    biz({ id: 'dormant', last_active_date: daysAgo(300) }),
  ];
  const out = orderBrowseResults(rows, { keywords: [], now: NOW });
  assert.equal(out[0].id, 'verified');
  assert.equal(out.at(-1).id, 'dormant');
});

test('never-onboarded rows are gone before ranking, not just sorted last', () => {
  const rows = [
    biz({ id: 'ghost', onboarding_completed: false, name: 'Addis Printing' }),
    biz({ id: 'real', name: 'Addis Printing' }),
  ];
  const out = orderBrowseResults(rows, { keywords: ['printing'], now: NOW });
  assert.deepEqual(out.map(r => r.id), ['real']);
});
