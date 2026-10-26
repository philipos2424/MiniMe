import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_STARS_PER_ETB, normalizeStarsPerEtb, starsForEtb, etbPerStar, isValidStarsPerEtb,
} from '../../starsRate.mjs';

const here = fileURLToPath(import.meta.url);
const root = here.slice(0, here.indexOf('apps'));
const src = p => readFileSync(`${root}apps/web/src/${p}`, 'utf8');

test('the live 3000 rate no longer quotes millions of Stars', () => {
  assert.equal(starsForEtb(1500, 3000), Math.round(1500 * DEFAULT_STARS_PER_ETB));
});

test('sane rates are honoured, junk falls back to the default', () => {
  assert.equal(starsForEtb(1500, 0.6), 900);
  assert.equal(starsForEtb(1500, 1), 1500);
  for (const bad of [0, -1, 3000, 'abc', null, undefined, NaN]) {
    assert.equal(normalizeStarsPerEtb(bad), DEFAULT_STARS_PER_ETB, String(bad));
  }
  assert.equal(isValidStarsPerEtb(5), true);
  assert.equal(isValidStarsPerEtb(5.01), false);
});

test('never quotes zero Stars', () => {
  assert.equal(starsForEtb(0.5, 0.05), 1);
});

test('etbPerStar is the inverse shown in settings', () => {
  assert.equal(etbPerStar(0.6), 1.67);
  assert.equal(etbPerStar(3000), 1.67);
});

test('both invoice paths use the guarded helper', () => {
  // agentBrain's create_order prices Stars through customerPayments.orderPayButtons.
  for (const f of ['lib/server/customerPayments.mjs', 'lib/server/replyEngine.js']) {
    const s = src(f);
    assert.match(s, /starsForEtb\(/, f);
    assert.doesNotMatch(s, /stars_per_etb \|\| 1/, f);
  }
});

test('settings API rejects out-of-range rates', () => {
  assert.match(src('app/api/settings/payments/route.js'), /isValidStarsPerEtb/);
});
