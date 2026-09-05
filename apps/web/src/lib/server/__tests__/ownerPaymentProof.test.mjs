/**
 * Paying by screenshot in the bot chat.
 *
 * The chat is now a payment entry point, which is exactly the kind of
 * convenience that quietly becomes a second, laxer way to get Pro. These tests
 * hold the line that it is a new DOOR, not a new LOCK: the decision stays in
 * paymentProof.js, and the chat path may only read an image and call it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const hookSrc = read('ownerPaymentProof.js');
const hook = stripComments(hookSrc);
const screenshot = stripComments(read('paymentScreenshot.js'));
const coreSrc = read('paymentProof.js');
const core = stripComments(coreSrc);
const route = stripComments(read('../../app/api/payment/subscribe/proof/route.js'));

test('the chat path grants nothing itself — it calls the shared decision', () => {
  assert.match(hook, /submitPaymentProof/);
  for (const forbidden of [
    /subscription_status/, /plan_tier/, /payment_verified:\s*true/,
    /upgradeSubscription/, /applyVerificationOutcome/,
  ]) {
    assert.ok(!forbidden.test(hook),
      `the chat hook writes entitlement itself (${forbidden}) instead of leaving it to paymentProof.js`);
  }
});

test('the Mini App route grants nothing itself either', () => {
  assert.match(route, /submitPaymentProof/);
  assert.ok(!/subscription_status|plan_tier|upgradeSubscription/.test(route),
    'the route should be an adapter — the decision belongs to paymentProof.js');
});

test('verify-first survived the move out of the route', () => {
  // The fallback branch is the one that runs with no automated evidence at
  // all, so it is the one that must never activate on its own.
  // Sliced from the raw source — the branch is marked by a comment, which is
  // exactly what stripComments would remove — then stripped for the assertions.
  const fallback = stripComments(coreSrc.slice(coreSrc.indexOf('Fallback: no verify.et configured')));
  assert.match(fallback, /payment_state: 'in_review'/);
  assert.ok(!/subscription_status: 'active'/.test(fallback));
  assert.ok(!/plan_tier: 'pro'/.test(fallback));
  // And an unreadable reference is refused rather than waved through.
  assert.match(core, /bank_reference_required/);
});

test('a reference is never invented when the model cannot read one', () => {
  // The model is told not to complete a cut-off reference, and whatever it
  // returns is shape-checked before it can reach verify.et.
  assert.match(screenshot, /Do NOT invent, complete or correct it/);
  assert.match(screenshot, /\/\^\[A-Za-z0-9-\]\{6,32\}\$\//);
});

test('a photo is only treated as payment when the shop is mid-payment', () => {
  // Ordering matters: the cheap database gate must precede the Vision call, or
  // every product photo on the platform starts costing an LLM call.
  // Measured inside the handler, not the whole file: the import of
  // readPaymentScreenshot and the definition of hasPendingPayment both sit
  // above it in source order and say nothing about call order.
  const handler = hook.slice(hook.indexOf('export async function maybeHandlePaymentScreenshot'));
  const gateAt = handler.indexOf('hasPendingPayment(business)');
  const visionAt = handler.indexOf('readPaymentScreenshot(');
  assert.ok(gateAt > 0 && visionAt > 0, 'gate or vision call missing');
  assert.ok(gateAt < visionAt, 'the pending-payment gate must come before the Vision call');

  // payment_verified === true means settled; such a shop has nothing pending.
  assert.match(hook, /payment_verified !== true/);
});

test('a non-receipt photo falls through to the normal photo handling', () => {
  assert.match(hook, /if \(!read\?\.isPayment\) return false;/);
});

test('the owner photo hook runs before teachFromPhoto in the reply engine', () => {
  const engine = stripComments(read('replyEngine.js'));
  const hookAt = engine.indexOf('maybeHandlePaymentScreenshot');
  const teachAt = engine.indexOf("Owner sends a photo (not forwarded)");
  const photoTeachAt = engine.indexOf('teachFromPhoto', hookAt);
  assert.ok(hookAt > 0, 'payment hook not wired into replyEngine');
  assert.ok(hookAt < photoTeachAt || teachAt === -1,
    'a payment receipt would be filed as business knowledge before the payment hook sees it');
});

test('a typed transaction number is routed before the interview and teaching flows', () => {
  const engine = stripComments(read('replyEngine.js'));
  const referenceAt = engine.indexOf('maybeHandlePaymentReferenceReply');
  const interviewAt = engine.indexOf('getInterviewState');
  const commandAt = engine.indexOf('STAFF_SAFE_COMMANDS');
  assert.ok(referenceAt > 0, 'payment reference hook not wired into replyEngine');
  assert.ok(referenceAt < interviewAt, 'an owner transaction number can be consumed by the interview flow');
  assert.ok(referenceAt < commandAt, 'an owner transaction number must be handled before generic owner commands');
});
