/**
 * Guards on every path that can grant Pro.
 *
 * Context: ~600 accounts reached Pro without paying, and the platform admin was
 * never told about any of it. Three distinct defects made that possible, and
 * each one is cheap to reintroduce, so each gets a test here:
 *
 *   1. /api/payment/webhook granted Pro on any unsigned POST.
 *   2. The admin "Activate" button wrote subscription_status='active' with no
 *      expiry, which planStatus() reads as permanent free Pro.
 *   3. Only the proof-upload path told the admin anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = process.cwd().replace(/apps[\\/]web$/, '');
const read = p => readFileSync(`${root}apps/web/src/${p}`, 'utf8');

// These files document the very defects being asserted against, so a naive
// text search hits the comment describing the old bug and reports it as still
// present. Assertions about code SHAPE run against the comment-free source;
// assertions about intent (below) may still read the whole file.
const stripComments = s => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const webhook = read('app/api/payment/webhook/route.js');
const webhookCode = stripComments(webhook);
const bizPatch = read('app/api/admin/businesses/[id]/route.js');
const subscribe = read('app/api/payment/subscribe/route.js');
const proof = read('app/api/payment/subscribe/proof/route.js');
// The fallback that runs when verify.et is unconfigured — the only branch that
// can grant without any automated evidence.
const proofFallback = stripComments(
  proof.slice(proof.indexOf('Fallback: no verify.et configured')));
const activation = read('lib/server/trialActivation.js');
const plan = read('lib/plan.js');

// ── 1. The webhook ──────────────────────────────────────────────────────────

test('the webhook rejects unsigned requests', () => {
  assert.match(webhook, /unsigned/,
    'no rejection path for a request carrying no signature header');
  assert.match(webhook, /status: 401/);
});

test('no grant is reachable without a signature check first', () => {
  // The load-bearing assertion. Every early `return` for a bad signature must
  // appear BEFORE the single call to upgradeSubscription.
  const grantAt = webhookCode.indexOf('await upgradeSubscription(');
  assert.ok(grantAt > 0, 'upgradeSubscription call not found');

  const before = webhookCode.slice(0, grantAt);
  for (const marker of ['verifyStripe', 'verifyChapa', 'status: 401']) {
    assert.ok(before.includes(marker), `${marker} does not precede the grant`);
  }
  // And only one grant call — a second one could bypass the checks above.
  assert.equal(webhookCode.split('await upgradeSubscription(').length - 1, 1);
});

test('signatures are compared in constant time, never with ===', () => {
  assert.match(webhookCode, /timingSafeEqual/);
  assert.ok(!/sig\s*===|signature\s*===/.test(webhookCode), 'raw equality on a signature');
});

test('stripe signatures are replay-windowed, not just verified', () => {
  // Without an age check a captured webhook replays forever.
  assert.match(webhook, /Math\.abs\(Date\.now\(\) \/ 1000 - t\) > 300/);
});

test('the old catch-all success detection is gone', () => {
  // `body.paid === true` / bare `status === 'completed'` accepted any JSON.
  assert.ok(!/body\.paid === true/.test(webhookCode), 'body.paid catch-all still present');
  assert.ok(!/body\.status === 'completed'/.test(webhookCode), "status==='completed' catch-all still present");
});

// ── 2. 'active' always carries an expiry ────────────────────────────────────

test("planStatus still treats a null expiry as unlimited — so writers must not create one", () => {
  // This test documents WHY the guard below exists. If this assertion ever
  // fails, planStatus was tightened and the guard can be revisited.
  assert.match(plan, /const activeSub = status === 'active' && \(!expiresAt \|\| expiresAt > now\)/);
});

test('activating a business always sets an expiry', () => {
  const at = bizPatch.indexOf("updates.subscription_status === 'active'");
  assert.ok(at > 0, 'no guard on activation');
  const block = bizPatch.slice(at, at + 500);
  assert.match(block, /subscription_expires_at/);
  // The guard must run BEFORE the row is written.
  assert.ok(at < bizPatch.indexOf('.update(updates)'), 'guard runs after the update');
});

test('an explicit expiry from the caller is still honoured', () => {
  assert.match(bizPatch, /!\('subscription_expires_at' in updates\)/);
});

// ── 3. Every grant is announced ─────────────────────────────────────────────

test('the admin is notified when Pro is granted', () => {
  assert.match(bizPatch, /notifyAdminActivation/);
  assert.match(webhook, /notifyAdminActivation/);
});

test('the alert says which path granted it', () => {
  // "granted by what" is the whole point — an unexpected grant must be
  // attributable rather than a mystery.
  assert.match(activation, /source/);
  assert.match(bizPatch, /source: 'admin_edit'/);
  assert.match(webhook, /source: `webhook:\$\{provider\}`/);
});

test('paid and comped grants are visibly different to the admin', () => {
  assert.match(activation, /paid \? '💰' : '🎁'/);
  assert.match(activation, /granted \(unpaid\)/);
});

// ── 4. The owner welcome ────────────────────────────────────────────────────

test('the welcome goes out on the platform bot, not the shop bot', () => {
  // Owners who never linked their own bot would otherwise never receive it.
  assert.match(activation, /process\.env\.TELEGRAM_BOT_TOKEN/);
});

test('shop names are Markdown-escaped before interpolation', () => {
  // Telegram 400s the entire message on a parse failure, so a shop called
  // "deal_maker" would silently never get welcomed.
  assert.match(activation, /function mdEscape/);
  assert.match(activation, /mdEscape\(name\)/);
});

// ── 5. An uploaded screenshot is not a payment ──────────────────────────────

test('a proof upload never activates on its own', () => {
  // It used to auto-activate monthly plans on any image — nothing here reads
  // the screenshot, so a photo of a wall bought a month of Pro.
  assert.match(proofFallback, /subscription_status: 'pending_review'/);
  assert.ok(!/subscription_status: 'active'/.test(proofFallback),
    'the no-verification path still activates a subscription');
  assert.ok(!/plan_tier: 'pro'/.test(proofFallback),
    'the no-verification path still grants the pro tier');
});

test('both plans go through the same human gate', () => {
  // Monthly used to skip review entirely; annual got Approve/Reject.
  assert.match(proofFallback, /sub_approve_/);
  assert.match(proofFallback, /sub_reject_/);
  assert.ok(!/Revoke \(if fake\)/.test(proofFallback),
    'still offering revoke-after-the-fact instead of approve-before-access');
});

test('the owner hears back even without their own bot linked', () => {
  // Gated on telegram_bot_token_enc, a merchant who never linked a bot got
  // silence after uploading — which reads as "it failed".
  assert.ok(!/business\.telegram_bot_token_enc/.test(proofFallback),
    'owner confirmation is still gated on the shop having its own bot');
  assert.match(proofFallback, /tg\(platformToken/);
});

test('re-uploading cannot extend the review hold', () => {
  // The hold caps how long an unreviewed payment freezes a shop's expiry. If
  // the anchor were re-stamped on every upload, a merchant could resubmit any
  // image every 13 days and hold their expiry open forever — handing the cap
  // to the person it caps.
  const code = stripComments(proof);
  assert.match(code, /const reviewAnchor =/, 'no review anchor computed');
  assert.match(code, /business\.subscription_status === 'pending_review' && business\.payment_submitted_at/,
    'the anchor does not check for an already-open review');

  // Nothing may stamp a raw timestamp into that column.
  assert.ok(!/payment_submitted_at: now\.toISOString\(\)/.test(code),
    'payment_submitted_at is still stamped with the current time');
  assert.ok(!/payment_submitted_at: new Date\(\)\.toISOString\(\)/.test(code),
    'payment_submitted_at is still stamped with the current time');

  // Every write of the column must go through the anchor.
  const writes = code.match(/payment_submitted_at: [^,\n]+/g) || [];
  assert.ok(writes.length >= 2, `expected both review paths to set it, found ${writes.length}`);
  for (const w of writes) {
    assert.match(w, /reviewAnchor/, `unanchored write: ${w}`);
  }
});

// ── 6. One reference, not two ───────────────────────────────────────────────

test('the reference shown, stored, and validated are the same value', () => {
  // The merchant was told "SUB-698505" while we stored
  // "sub-tb-69850534-1783604266868" — a payment that arrived carried a code
  // appearing nowhere in our data.
  const code = stripComments(subscribe);
  assert.match(code, /reference: manualRef/);
  assert.match(code, /payment_ref: manualRef/);
  assert.match(code, /tx_ref: manualRef/);
  assert.ok(!/SUB-\$\{business\.id/.test(code), 'the divergent short code is back');
});

test('each payment attempt gets its own reference', () => {
  // `SUB-` + business id was identical for every attempt by the same shop, so
  // a renewal and a first payment were indistinguishable on a bank statement.
  const decl = stripComments(subscribe).match(/const manualRef = [^;]+;/);
  assert.ok(decl, 'manualRef declaration not found');
  assert.match(decl[0], /Date\.now\(\)/, 'reference has no per-attempt component');
});

test('the welcome tells the owner what MiniMe actually does', () => {
  // A bare "you're activated" taught the owner nothing; most have only ever
  // seen MiniMe answer a customer.
  for (const capability of ['answer your customers', 'take orders', 'learn from you']) {
    assert.ok(activation.includes(capability), `welcome does not mention: ${capability}`);
  }
});
