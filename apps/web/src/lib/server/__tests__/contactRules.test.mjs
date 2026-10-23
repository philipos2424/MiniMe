import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prunePending, contactRuleFor, parseTriage, PENDING_MAX_ENTRIES } from '../contactRules.mjs';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const ago = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

test('prunePending drops threads older than 48h and keeps fresh ones', () => {
  const out = prunePending({ a: { at: ago(1) }, b: { at: ago(47) }, c: { at: ago(49) }, d: { at: ago(24 * 9) } }, NOW);
  assert.deepEqual(Object.keys(out).sort(), ['a', 'b']);
});

test('prunePending drops entries with no usable timestamp', () => {
  assert.deepEqual(prunePending({ a: {}, b: { at: 'garbage' }, c: null }, NOW), {});
});

test('prunePending falls back to asked_at and tolerates empty input', () => {
  assert.deepEqual(Object.keys(prunePending({ a: { asked_at: ago(2) } }, NOW)), ['a']);
  assert.deepEqual(prunePending(undefined, NOW), {});
});

test('prunePending caps at the newest PENDING_MAX_ENTRIES', () => {
  const big = {};
  for (let i = 0; i < PENDING_MAX_ENTRIES + 10; i++) big[`u${i}`] = { at: new Date(NOW - i * 60000).toISOString() };
  const out = prunePending(big, NOW);
  assert.equal(Object.keys(out).length, PENDING_MAX_ENTRIES);
  assert.ok('u0' in out);
  assert.ok(!(`u${PENDING_MAX_ENTRIES + 9}` in out));
});

test('contactRuleFor reads valid rules by string or number id', () => {
  const prefs = { contact_rules: { 42: { rule: 'never' }, 7: { rule: 'auto' }, 9: { rule: 'ask' } } };
  assert.equal(contactRuleFor(prefs, 42), 'never');
  assert.equal(contactRuleFor(prefs, '7'), 'auto');
  assert.equal(contactRuleFor(prefs, 9), 'ask');
});

test('contactRuleFor ignores unknown, malformed and missing rules', () => {
  assert.equal(contactRuleFor({ contact_rules: { 1: { rule: 'block' } } }, 1), null);
  assert.equal(contactRuleFor({ contact_rules: { 1: 'never' } }, 1), null);
  assert.equal(contactRuleFor({}, 1), null);
  assert.equal(contactRuleFor(null, 1), null);
  assert.equal(contactRuleFor({ contact_rules: { 1: { rule: 'never' } } }, undefined), null);
});

test('parseTriage: clear answers map through, doubt becomes unsure', () => {
  assert.equal(parseTriage('Customer'), 'customer');
  assert.equal(parseTriage('family.'), 'family');
  assert.equal(parseTriage(' friend\n'), 'friend');
  assert.equal(parseTriage('unsure'), 'unsure');
  assert.equal(parseTriage(''), 'unsure');
  assert.equal(parseTriage(null), 'unsure');
  assert.equal(parseTriage('hmm, maybe'), 'unsure');
});

import { shouldNotifyAutoSent } from '../contactRules.mjs';

test('shouldNotifyAutoSent: defaults keep today\'s behaviour (always ping)', () => {
  assert.equal(shouldNotifyAutoSent({}, { isSecretary: true, isPersonal: false, isFirstReply: false }), true);
  assert.equal(shouldNotifyAutoSent(undefined, { isSecretary: true, isPersonal: true, isFirstReply: false }), true);
});

test('shouldNotifyAutoSent: shop-bot replies are never gated', () => {
  const prefs = { secretary_alerts: 'off', alerts_personal: false };
  assert.equal(shouldNotifyAutoSent(prefs, { isSecretary: false, isPersonal: true, isFirstReply: false }), true);
});

test('shouldNotifyAutoSent: first-only pings the opening reply and nothing after', () => {
  const prefs = { secretary_alerts: 'first' };
  assert.equal(shouldNotifyAutoSent(prefs, { isSecretary: true, isFirstReply: true }), true);
  assert.equal(shouldNotifyAutoSent(prefs, { isSecretary: true, isFirstReply: false }), false);
});

test('shouldNotifyAutoSent: off silences, personal toggle hides family/friends only', () => {
  assert.equal(shouldNotifyAutoSent({ secretary_alerts: 'off' }, { isSecretary: true, isFirstReply: true }), false);
  const p = { alerts_personal: false };
  assert.equal(shouldNotifyAutoSent(p, { isSecretary: true, isPersonal: true, isFirstReply: true }), false);
  assert.equal(shouldNotifyAutoSent(p, { isSecretary: true, isPersonal: false, isFirstReply: false }), true);
});

test('shouldNotifyAutoSent: junk mode values fall back to all', () => {
  assert.equal(shouldNotifyAutoSent({ secretary_alerts: 'weird' }, { isSecretary: true, isFirstReply: false }), true);
});

import { decideUnknownSender } from '../contactRules.mjs';

test('decideUnknownSender: per-person rule beats the global mode both ways', () => {
  assert.equal(decideUnknownSender({ mode: 'auto', rule: 'ask', triage: null }), 'ask');
  assert.equal(decideUnknownSender({ mode: 'ask_first', rule: 'auto', triage: null }), 'auto');
  assert.equal(decideUnknownSender({ mode: 'smart', rule: 'ask', triage: 'customer' }), 'ask');
});

test('decideUnknownSender: smart replies only when the triage is clear', () => {
  for (const t of ['customer', 'family', 'friend']) assert.equal(decideUnknownSender({ mode: 'smart', rule: null, triage: t }), 'auto');
  assert.equal(decideUnknownSender({ mode: 'smart', rule: null, triage: 'unsure' }), 'ask');
  assert.equal(decideUnknownSender({ mode: 'smart', rule: null, triage: null }), 'ask');
});

test('decideUnknownSender: default and auto modes', () => {
  assert.equal(decideUnknownSender({ mode: 'ask_first', rule: null, triage: 'customer' }), 'ask');
  assert.equal(decideUnknownSender({ mode: undefined, rule: null, triage: null }), 'ask');
  assert.equal(decideUnknownSender({ mode: 'auto', rule: null, triage: 'unsure' }), 'auto');
});
