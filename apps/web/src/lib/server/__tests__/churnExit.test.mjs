/**
 * Asking the people who can actually answer.
 *
 * The exit question already exists and works: reengage/copy.mjs sends chips,
 * agent-bot/webhook records the tap, the admin dashboard and the weekly digest
 * read it. It has produced 5 reasons in the platform's lifetime, from 260
 * sends — because it is only ever asked of people who abandoned SIGNUP. Someone
 * who never finished creating a shop can tell you the form was confusing. They
 * cannot tell you why a working shop went quiet.
 *
 * The 72 shops that had real customer traffic and then stopped are the only
 * people who know that, and not one of them has ever been asked. Migration 051
 * is what makes asking possible at all: until last_shop_activity_date existed,
 * we could not identify a shop that had gone quiet — last_active_date was NULL
 * for 732 shops that had been busy for weeks.
 *
 * The rules below are mostly about restraint. An exit question sent to someone
 * still using the product is an insult; sent twice, it is worse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHURN_EXIT_REASONS,
  churnExitEligibility,
  churnExitMessage,
  parseChurnExitCallback,
  CHURN_EXIT_PREFIX,
} from '../churnExit.mjs';

const NOW = Date.parse('2026-09-05T09:00:00Z');
const dayAgo = n => new Date(NOW - n * 86400000).toISOString().slice(0, 10);

// A shop that used MiniMe for real and has since gone quiet.
const quietShop = extra => ({
  id: 'shop-1',
  name: 'Bole Fabrics',
  owner_name: 'Selam Tesfaye',
  owner_private_chat_id: 4242,
  last_shop_activity_date: dayAgo(28),
  notification_prefs: {},
  ...extra,
});

// ── Who gets asked ──────────────────────────────────────────────────────────

test('a shop that went quiet four weeks ago is asked', () => {
  const d = churnExitEligibility(quietShop(), { now: NOW });
  assert.equal(d.ask, true);
});

test('a shop still trading this week is not asked', () => {
  // The single worst failure mode: asking a working merchant why they left.
  const d = churnExitEligibility(quietShop({ last_shop_activity_date: dayAgo(3) }), { now: NOW });
  assert.equal(d.ask, false);
  assert.equal(d.reason, 'still_active');
});

test('a shop that never had any traffic is not asked', () => {
  // 792 of 957 shops never exchanged a message. They have no experience to
  // report, and reengage already owns the signup-abandonment question.
  const d = churnExitEligibility(quietShop({ last_shop_activity_date: null }), { now: NOW });
  assert.equal(d.ask, false);
  assert.equal(d.reason, 'never_active');
});

test('a shop quiet for over four months is left in peace', () => {
  const d = churnExitEligibility(quietShop({ last_shop_activity_date: dayAgo(200) }), { now: NOW });
  assert.equal(d.ask, false);
  assert.equal(d.reason, 'too_long_ago');
});

test('an owner we cannot message is not asked', () => {
  const d = churnExitEligibility(quietShop({ owner_private_chat_id: null }), { now: NOW });
  assert.equal(d.ask, false);
  assert.equal(d.reason, 'unreachable');
});

test('an owner who opted out of nudges is not asked', () => {
  const d = churnExitEligibility(
    quietShop({ notification_prefs: { owner_nudges: { opted_out: true } } }), { now: NOW });
  assert.equal(d.ask, false);
  assert.equal(d.reason, 'opted_out');
});

test('nobody is ever asked twice', () => {
  const d = churnExitEligibility(quietShop(), { now: NOW, askedAt: '2026-08-20T00:00:00Z' });
  assert.equal(d.ask, false);
  assert.equal(d.reason, 'already_asked');
});

// ── What we send ────────────────────────────────────────────────────────────

test('the message names the shop and asks nothing else of them', () => {
  const m = churnExitMessage(quietShop());
  assert.match(m.text, /Bole Fabrics/);
  assert.match(m.text, /Selam/);
  // No upsell. This message sells nothing — the moment it does, the answer
  // stops being honest and the reply rate goes with it.
  assert.doesNotMatch(m.text, /upgrade|Pro|1,?999|ETB/i);
});

test('the message speaks Amharic too', () => {
  // Every other owner-facing nudge in the product is bilingual; an exit
  // question in English only selects for English speakers' reasons.
  assert.match(churnExitMessage(quietShop()).text, /[ሀ-፿]/);
});

test('every button carries a reason we can store', () => {
  const rows = churnExitMessage(quietShop()).buttons;
  const actions = rows.flat().map(b => b.action);
  assert.ok(actions.length >= 4, 'too few options to be a real question');
  for (const a of actions) {
    assert.ok(a.startsWith(CHURN_EXIT_PREFIX), `${a} is not a churn-exit action`);
    const slug = a.slice(CHURN_EXIT_PREFIX.length);
    assert.ok(CHURN_EXIT_REASONS[slug], `${slug} has no label to report it under`);
  }
});

test('the reasons fit someone who used the product, not someone who never started', () => {
  // reengage asks about setup ("too complicated", "no time"). A merchant whose
  // shop went quiet has different answers, and blurring the two makes both
  // datasets useless.
  assert.ok(CHURN_EXIT_REASONS.no_customers);
  assert.ok(CHURN_EXIT_REASONS.shop_closed);
});

// ── Reading the tap back ────────────────────────────────────────────────────

test('a tap resolves to its reason', () => {
  assert.equal(parseChurnExitCallback(`${CHURN_EXIT_PREFIX}no_customers`), 'no_customers');
});

test('an unknown reason is refused rather than stored as junk', () => {
  assert.equal(parseChurnExitCallback(`${CHURN_EXIT_PREFIX}whatever`), null);
});

test('the signup exit question is not mistaken for this one', () => {
  // Both write an exit reason; they must never land in the same bucket.
  assert.equal(parseChurnExitCallback('reengage_exit:too_complicated'), null);
  assert.equal(parseChurnExitCallback(''), null);
  assert.equal(parseChurnExitCallback(null), null);
});
