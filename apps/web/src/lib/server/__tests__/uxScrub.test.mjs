import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeLabel, safeMeta, safeTimestamp } from '../uxScrub.mjs';

// These tests guard a privacy property, not a feature. The Mini App renders real
// customer names, phone numbers and message bodies on conversations/, customers/
// and orders/; ux_events must never be able to hold any of it, regardless of
// what a client sends.

test('safeLabel keeps ordinary structural labels', () => {
  assert.equal(safeLabel('agent.reply.accept', 120), 'agent.reply.accept');
  assert.equal(safeLabel('button.mk-fav', 120), 'button.mk-fav');
  assert.equal(safeLabel('  /settings/billing  ', 200), '/settings/billing');
});

test('safeLabel drops phone numbers in every format owners actually use', () => {
  for (const phone of [
    '+251911223344',
    '+251 91 122 3344',
    '0911-223-344',
    '00251911223344',
    '(251) 911 223 344',
  ]) {
    assert.equal(safeLabel(phone, 120), null, `leaked: ${phone}`);
  }
});

test('safeLabel drops emails', () => {
  assert.equal(safeLabel('abebe@example.com', 120), null);
  assert.equal(safeLabel('Contact abebe@example.com now', 120), null);
});

test('safeLabel drops over-length values rather than truncating', () => {
  // Truncating prose would still store the first 120 characters of a customer
  // message. Dropping is the only safe answer.
  assert.equal(safeLabel('a'.repeat(500), 120), null);
});

test('safeLabel rejects non-strings and empties', () => {
  assert.equal(safeLabel(undefined, 120), null);
  assert.equal(safeLabel(null, 120), null);
  assert.equal(safeLabel(12345, 120), null);
  assert.equal(safeLabel('   ', 120), null);
});

test('safeMeta keeps only whitelisted keys', () => {
  const out = safeMeta({
    q: 'injera',
    via: 'voice',
    count: 7,
    ok: true,
    email: 'abebe@example.com',
    phone: '+251911223344',
    content: 'Selam, where is my order?',
    customer_name: 'Abebe',
  });
  assert.deepEqual(out, { q: 'injera', via: 'voice', count: 7, ok: true });
});

test('safeMeta drops whitelisted keys whose VALUE is PII', () => {
  // A whitelisted key is not a free pass — search queries can contain a phone
  // number, and that query is still a phone number.
  assert.equal(safeMeta({ q: 'call +251911223344' }), null);
  assert.deepEqual(safeMeta({ q: 'injera', source: 'abebe@example.com' }), { q: 'injera' });
});

test('safeMeta returns null rather than an empty object', () => {
  assert.equal(safeMeta({}), null);
  assert.equal(safeMeta(null), null);
  assert.equal(safeMeta('nope'), null);
  assert.equal(safeMeta(['q']), null);
});

test('safeTimestamp clamps a skewed device clock into range', () => {
  const now = Date.parse('2026-08-01T12:00:00Z');
  // Cheap handsets routinely have wall clocks minutes-to-years off; an
  // unclamped value would corrupt every date-range query over this table.
  assert.equal(safeTimestamp('2031-01-01T00:00:00Z', now), new Date(now).toISOString());
  assert.equal(safeTimestamp('2020-01-01T00:00:00Z', now), new Date(now).toISOString());
  assert.equal(safeTimestamp('garbage', now), new Date(now).toISOString());
});

test('safeTimestamp preserves plausible timestamps', () => {
  const now = Date.parse('2026-08-01T12:00:00Z');
  const recent = '2026-08-01T11:59:00.000Z';
  assert.equal(safeTimestamp(recent, now), recent);
});
