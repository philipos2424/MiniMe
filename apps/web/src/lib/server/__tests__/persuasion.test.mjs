import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persuasionContext, persuasionCues, persuasionLine, ctaLabel } from '../persuasion.mjs';

test('no fabricated social proof: a shop with too few reviews gets no rating cue', () => {
  const ctx = persuasionContext([{ id: 'a', average_rating: 5, total_reviews: 1 }]);
  const cues = persuasionCues({ id: 'a', average_rating: 5, total_reviews: 1 }, ctx);
  assert.ok(!cues.some(c => c.principle === 'social_proof' && c.text.includes('customers')));
});

test('real social proof surfaces for a well-reviewed shop', () => {
  const biz = { id: 'a', average_rating: 4.8, total_reviews: 42 };
  const ctx = persuasionContext([biz]);
  const cues = persuasionCues(biz, ctx);
  assert.ok(cues.some(c => c.text.includes('42 customers')));
});

test('verified shops get an authority cue', () => {
  const biz = { id: 'a', verified: true };
  const cues = persuasionCues(biz, persuasionContext([biz]));
  assert.ok(cues.some(c => c.principle === 'authority' && c.text.includes('Verified')));
});

test('top-rated is relative to the result set and requires real reviews', () => {
  const a = { id: 'a', average_rating: 4.9, total_reviews: 20 };
  const b = { id: 'b', average_rating: 4.2, total_reviews: 10 };
  const ctx = persuasionContext([a, b], { categoryLabel: 'Photography' });
  assert.equal(ctx.topRatedId, 'a');
  assert.ok(persuasionCues(a, ctx).some(c => c.text.includes('Top-rated')));
  assert.ok(!persuasionCues(b, ctx).some(c => c.text.includes('Top-rated')));
});

test('scarcity is truthful: sole match vs few matches vs many', () => {
  const single = persuasionContext([{ id: 'a' }]);
  assert.ok(persuasionCues({ id: 'a' }, single).some(c => c.text.includes('only match')
    || c.text.toLowerCase().includes('only match')));

  const few = persuasionContext([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  assert.ok(persuasionCues({ id: 'a' }, few).some(c => c.principle === 'scarcity' && c.text.includes('3 shops')));

  const many = persuasionContext(Array.from({ length: 10 }, (_, i) => ({ id: String(i) })));
  assert.ok(!persuasionCues({ id: '0' }, many).some(c => c.principle === 'scarcity'));
});

test('"popular" only fires when there is genuine search volume', () => {
  const lowTraffic = persuasionContext([{ id: 'a', search_count: 5 }, { id: 'b', search_count: 2 }]);
  assert.equal(lowTraffic.popularThreshold, Infinity);
  assert.ok(!persuasionCues({ id: 'a', search_count: 5 }, lowTraffic).some(c => c.text.includes('demand')));

  const busy = persuasionContext([{ id: 'a', search_count: 100 }, { id: 'b', search_count: 10 }]);
  assert.ok(persuasionCues({ id: 'a', search_count: 100 }, busy).some(c => c.text.includes('demand')));
});

test('cues are capped and ordered strongest-first', () => {
  const biz = { id: 'a', verified: true, average_rating: 5, total_reviews: 99, search_count: 100 };
  const ctx = persuasionContext([biz, { id: 'b', search_count: 10 }]);
  const cues = persuasionCues(biz, ctx, { max: 2 });
  assert.equal(cues.length, 2);
  assert.equal(cues[0].principle, 'authority');
});

test('persuasionLine joins cues; empty when nothing truthful to say', () => {
  const bland = { id: 'a' };
  const ctx = persuasionContext([bland, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]);
  assert.equal(persuasionLine(bland, ctx), '');
});

test('ctaLabel is warm and names the shop', () => {
  assert.ok(ctaLabel({ name: 'Abel Studio' }).includes('Abel Studio'));
});
