/**
 * Thread state — refresh policy and rendering.
 *
 * The exchange that produced this module, from a real chat:
 *
 *   customer: otp negeregn        →  bot: what do you need it for?
 *   customer: 218897
 *   customer: complete alehonem ende  →  bot: please explain what you'd like to complete
 *
 * Nothing carried "waiting on an OTP" from one turn to the next, so a bare
 * number was unreadable and the follow-up had no referent. These tests are
 * about the two halves of preventing that: keeping the state fresh while
 * something is pending, and telling the model plainly what it is waiting on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderThreadState, isEmptyThreadState, turnsSinceUpdate, shouldUpdateThreadState,
} from '../threadStateFormat.mjs';

const msgs = (...ids) => ids.map(id => ({ id, direction: 'inbound', content: 'x' }));

test('a chat with nothing pending renders nothing', () => {
  assert.equal(renderThreadState(null), '');
  assert.equal(renderThreadState({}), '');
  assert.equal(renderThreadState({ open_questions: [], commitments: [], known: {} }), '');
});

test('what we are waiting on is stated as an instruction, not a note', () => {
  const out = renderThreadState({ awaiting: 'the OTP code' });
  assert.match(out, /WAITING ON: the OTP code/);
  // The specific failure: a bare "218897" was treated as an unexplained
  // fragment instead of the answer to the question just asked.
  assert.match(out, /bare number/);
  assert.match(out, /Do not ask what it is/);
});

test('facts the customer already gave are marked never-ask-again', () => {
  const out = renderThreadState({ known: { quantity: '2', city: 'Addis' } });
  assert.match(out, /ALREADY TOLD YOU/);
  assert.match(out, /quantity: 2/);
  assert.match(out, /city: Addis/);
  assert.match(out, /Never ask for any of these again/);
});

test('questions already asked are listed so they are not asked twice', () => {
  const out = renderThreadState({ open_questions: ['which card design?'] });
  assert.match(out, /which card design\?/);
  assert.match(out, /Don't ask these again/);
});

test('goal, focus and commitments each render when present', () => {
  const out = renderThreadState({
    goal: 'buy an iConnect Card',
    product_focus: 'iConnect Card',
    commitments: ['confirm delivery by Tuesday'],
  });
  assert.match(out, /trying to: buy an iConnect Card/);
  assert.match(out, /Currently about: iConnect Card/);
  assert.match(out, /confirm delivery by Tuesday/);
});

test('isEmptyThreadState treats a fully blank state as empty', () => {
  assert.equal(isEmptyThreadState({ goal: null, awaiting: null, known: {}, open_questions: [] }), true);
  assert.equal(isEmptyThreadState({ awaiting: 'the OTP' }), false);
  assert.equal(isEmptyThreadState({ known: { city: 'Addis' } }), false);
});

test('turnsSinceUpdate counts from the message we were current through', () => {
  const window = msgs('a', 'b', 'c', 'd');
  assert.equal(turnsSinceUpdate({ updated_through: 'd' }, window), 0);
  assert.equal(turnsSinceUpdate({ updated_through: 'b' }, window), 2);
  // Scrolled out of the window entirely, or never written.
  assert.equal(turnsSinceUpdate({ updated_through: 'zz' }, window), Infinity);
  assert.equal(turnsSinceUpdate(null, window), Infinity);
});

test('while something is pending, the state refreshes every turn', () => {
  const window = msgs('a', 'b');
  const pending = { awaiting: 'the OTP code', updated_through: 'a' };
  assert.equal(shouldUpdateThreadState(pending, window), true,
    'a pending "waiting on X" is exactly what goes stale from one message to the next');

  const asked = { open_questions: ['which size?'], updated_through: 'a' };
  assert.equal(shouldUpdateThreadState(asked, window), true);
});

test('with nothing pending it refreshes every third turn', () => {
  const idle = { goal: 'browsing', updated_through: 'a' };
  assert.equal(shouldUpdateThreadState(idle, msgs('a', 'b')), false);
  assert.equal(shouldUpdateThreadState(idle, msgs('a', 'b', 'c')), false);
  assert.equal(shouldUpdateThreadState(idle, msgs('a', 'b', 'c', 'd')), true);
});

test('no state yet always builds one; a state current for this turn does not', () => {
  assert.equal(shouldUpdateThreadState(null, msgs('a')), true);
  assert.equal(shouldUpdateThreadState({ awaiting: 'x', updated_through: 'a' }, msgs('a')), false);
});
