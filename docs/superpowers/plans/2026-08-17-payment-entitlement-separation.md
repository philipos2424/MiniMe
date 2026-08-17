# Payment / Entitlement State Separation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give payment lifecycle its own column so that recording a payment can never change who has access.

**Architecture:** `businesses.subscription_status` currently answers two unrelated questions with one value: *"does this shop get Pro?"* (`trial`/`active`/`expired`/`cancelled`) and *"is a payment being reviewed?"* (`pending_review`). Writing the second answer destroys the first. We add a `payment_state` column that owns the payment lifecycle, leave `subscription_status` owning entitlement alone, and delete the compensating machinery that exists only because the two were fused.

**Tech Stack:** Next.js 14 App Router (`apps/web`), Node 20, Supabase (Postgres), `node --test` with `.test.mjs` files, plain JS (no TypeScript).

**Spec:** This document. The design argument is in "Why" below; there is no separate spec.

## Why

Three of the six commits on `fix/payment-verification` fixed a bug introduced by the commit before it, and every one of them had the same shape:

1. `8da3234` stopped proof uploads from auto-activating → uploads now write `pending_review`.
2. `5fb2e73` — writing `pending_review` revoked the trial of anyone who paid, because `onTrial` requires `status === 'trial'`. Patched `planStatus` to treat `pending_review` as "keep what you had".
3. `584fce5` — preserving wasn't enough; a trial could still lapse mid-review. Added `payment_submitted_at` + a 14-day clock hold.
4. `8cfd2fb` — the hold was re-anchored on every upload, so re-submitting any image every 13 days held access open forever. Anchored it to the cycle instead.

Each fix was correct and each created the next problem, because all of them were working around one thing: **an entitlement field being used to store payment progress.** Once separated, steps 2–4 stop being necessary at all — a merchant who uploads proof simply stays on trial, because nothing touched their trial.

This is also why it is worth doing before the next payment feature rather than after.

## Global Constraints

- **No behaviour change for entitlement.** After this refactor, `planStatus(b).isPro` must return the same answer for every existing row as it does today. The migration is a data reshape, not a policy change.
- **Never widen access during migration.** If a backfill is ambiguous, choose the more restrictive entitlement and let an admin correct it.
- Plain JS, no TypeScript. Match the surrounding comment density — this codebase explains *why*, not *what*.
- `packages/shared/plan.js` is a hand-maintained CommonJS mirror of `apps/web/src/lib/plan.js` consumed by `apps/bot`. Every change to `planStatus` must land in both, and `pendingReviewAccess.test.mjs` compares them.
- Tests run with `npm test` from `apps/web`. All 338 existing tests must still pass at every commit.
- Migrations live in `supabase/migrations/*.sql`, are applied by hand in the Supabase SQL editor, and must be safe to run twice (`if not exists`, idempotent updates).
- Every route that reads or writes these columns must tolerate `payment_state` being absent until the migration is applied — same defensive pattern as `updateTolerantly()` in `api/payment/subscribe/proof/route.js`.

## File Structure

**New:**
- `supabase/migrations/payment_state.sql` — adds the column, backfills it, restores entitlement for in-review rows.
- `apps/web/src/lib/paymentLifecycle.js` — the `PAYMENT_STATES` vocabulary and helpers. Client-safe and dependency-free, same shape as the existing `lib/paymentState.js`.
- `apps/web/src/lib/server/__tests__/paymentLifecycle.test.mjs` — covers the new module and the separation invariant.

**Modified:**
- `apps/web/src/lib/plan.js` — `planStatus()` loses `inReview`/`reviewSub`/`asOf`/`REVIEW_HOLD_DAYS`.
- `packages/shared/plan.js` — same, mirrored.
- `apps/web/src/app/api/payment/subscribe/proof/route.js` — writes `payment_state`, stops writing `subscription_status`.
- `apps/web/src/lib/server/paymentVerification.js` — same, both branches.
- `apps/web/src/app/api/admin/businesses/[id]/route.js` — drops `pending_review` from the status enum, clears `payment_state` on decision.
- `apps/web/src/app/api/cron/stale-reviews/route.js` — queues on `payment_state`.
- `apps/web/src/app/api/admin/overview/route.js`, `pulse/route.js` — review queue reads `payment_state`.
- `apps/web/src/app/admin/page.js` — review-queue predicate.
- `apps/web/src/lib/paymentState.js` — `paymentState()` gains an `in_review` bucket sourced from the new column.

**Deliberately not touched:** `apps/bot/src/services/payment.js` and `apps/bot/src/cron/trial-checker.js` write only `active`/`expired`, which remain valid entitlement values.

---

### Task 1: The `payment_state` column and backfill

**Files:**
- Create: `supabase/migrations/payment_state.sql`
- Create: `apps/web/src/lib/paymentLifecycle.js`
- Test: `apps/web/src/lib/server/__tests__/paymentLifecycle.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `PAYMENT_LIFECYCLE_STATES` (array of strings), `isAwaitingDecision(business)` → boolean, `PAYMENT_LIFECYCLE_LABELS` (object keyed by state, each `{ label, hint }`).

- [ ] **Step 1: Write the failing test**

```javascript
// apps/web/src/lib/server/__tests__/paymentLifecycle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_LIFECYCLE_STATES, isAwaitingDecision, PAYMENT_LIFECYCLE_LABELS,
} from '../../paymentLifecycle.js';

test('the vocabulary is closed and ordered by progress', () => {
  assert.deepEqual(PAYMENT_LIFECYCLE_STATES,
    ['awaiting_proof', 'in_review', 'verifying', 'rejected']);
});

test('every state has a label and a hint', () => {
  for (const s of PAYMENT_LIFECYCLE_STATES) {
    assert.ok(PAYMENT_LIFECYCLE_LABELS[s]?.label, `${s} has no label`);
    assert.ok(PAYMENT_LIFECYCLE_LABELS[s]?.hint, `${s} has no hint`);
  }
});

test('only in_review and verifying need a decision', () => {
  assert.equal(isAwaitingDecision({ payment_state: 'in_review' }), true);
  assert.equal(isAwaitingDecision({ payment_state: 'verifying' }), true);
  assert.equal(isAwaitingDecision({ payment_state: 'awaiting_proof' }), false);
  assert.equal(isAwaitingDecision({ payment_state: 'rejected' }), false);
});

test('a row with no payment activity is not awaiting anything', () => {
  // Rows predating the column read as null, which must never queue for review.
  assert.equal(isAwaitingDecision({}), false);
  assert.equal(isAwaitingDecision({ payment_state: null }), false);
  assert.equal(isAwaitingDecision(null), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/paymentLifecycle.test.mjs`
Expected: FAIL — `Cannot find module '../../paymentLifecycle.js'`

- [ ] **Step 3: Write the module**

```javascript
// apps/web/src/lib/paymentLifecycle.js
/**
 * Where a payment has got to — NOT whether the shop has access.
 *
 * These two questions used to share businesses.subscription_status, so
 * recording that a payment had arrived overwrote whether the merchant was on
 * trial. Paying us made a shop's access worse, and three separate commits went
 * into compensating for that rather than separating the two.
 *
 * subscription_status now answers only "does this shop get Pro"
 * (trial/active/expired/cancelled). This answers only "what is happening with
 * their money". Nothing here may ever be read to decide entitlement.
 */
export const PAYMENT_LIFECYCLE_STATES = [
  'awaiting_proof',  // asked how to pay, nothing uploaded yet
  'in_review',       // proof uploaded, a human must decide
  'verifying',       // verify.et is checking, no human needed yet
  'rejected',        // decided against; the shop keeps whatever access it had
];

export const PAYMENT_LIFECYCLE_LABELS = {
  awaiting_proof: { label: 'Awaiting proof', hint: 'Asked how to pay, nothing uploaded yet' },
  in_review:      { label: 'In review',      hint: 'Proof uploaded, waiting on an admin decision' },
  verifying:      { label: 'Verifying',      hint: 'verify.et is checking with the bank' },
  rejected:       { label: 'Rejected',       hint: 'Could not be confirmed' },
};

/** Is a human or a pending check standing between this payment and a decision? */
export function isAwaitingDecision(business) {
  const s = business?.payment_state;
  return s === 'in_review' || s === 'verifying';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && node --test src/lib/server/__tests__/paymentLifecycle.test.mjs`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the migration**

```sql
-- supabase/migrations/payment_state.sql
--
-- Payment lifecycle gets its own column.
--
-- subscription_status carried both "does this shop get Pro" and "is a payment
-- being reviewed". Writing the second destroyed the first: a merchant on day 3
-- of their trial who uploaded proof stopped being on trial, so paying us made
-- their access worse. Three commits went into compensating for that.
--
-- After this, subscription_status means entitlement ONLY and never holds
-- 'pending_review'.
--
-- Safe to run twice.

alter table businesses
  add column if not exists payment_state text;

alter table businesses
  drop constraint if exists businesses_payment_state_check;
alter table businesses
  add constraint businesses_payment_state_check
  check (payment_state is null or payment_state in
    ('awaiting_proof', 'in_review', 'verifying', 'rejected'));

-- Move every in-flight review across, and give those rows back a real
-- entitlement value. Their true prior status was overwritten when
-- 'pending_review' was written, so it is reconstructed from the date columns,
-- which were never touched. Ambiguity resolves to the MORE restrictive answer:
-- an admin can widen access, a wrongly-widened grant is invisible.
update businesses
set payment_state = case
      when verifyet_request_id is not null then 'verifying'
      else 'in_review'
    end,
    subscription_status = case
      when trial_ends_at is not null and trial_ends_at > now() then 'trial'
      when subscription_expires_at is not null and subscription_expires_at > now() then 'active'
      else 'expired'
    end
where subscription_status = 'pending_review';

-- Merchants who asked how to pay and never uploaded anything.
update businesses
set payment_state = 'awaiting_proof'
where payment_state is null
  and payment_ref is not null
  and payment_proof_url is null
  and coalesce(payment_verified, false) = false;

-- 'pending_review' is no longer a legal entitlement value.
alter table businesses
  drop constraint if exists businesses_subscription_status_check;
alter table businesses
  add constraint businesses_subscription_status_check
  check (subscription_status in ('trial', 'active', 'expired', 'cancelled'));

create index if not exists businesses_payment_state_idx
  on businesses (payment_state) where payment_state is not null;

comment on column businesses.payment_state is
  'Payment lifecycle only. Never read this to decide entitlement — see subscription_status.';
```

- [ ] **Step 6: Verify the migration is reversible on paper**

Run: read the migration and confirm every `update` has a `where` that excludes already-migrated rows.
Expected: the first update filters `subscription_status = 'pending_review'` (empty on re-run); the second filters `payment_state is null`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/payment_state.sql apps/web/src/lib/paymentLifecycle.js apps/web/src/lib/server/__tests__/paymentLifecycle.test.mjs
git commit -m "payments: add payment_state column for the payment lifecycle"
```

---

### Task 2: `planStatus()` stops knowing about reviews

**Files:**
- Modify: `apps/web/src/lib/plan.js` (the `REVIEW_HOLD_DAYS` export and the body of `planStatus`)
- Modify: `packages/shared/plan.js` (same, mirrored)
- Test: `apps/web/src/lib/server/__tests__/pendingReviewAccess.test.mjs` (rewrite)

**Interfaces:**
- Consumes: `PAYMENT_LIFECYCLE_STATES` from Task 1 (test only).
- Produces: `planStatus(business)` → `{ isPro, onTrial, trialDaysLeft, tier, status, activeSub, expired }` — same shape as today, minus any review awareness. `REVIEW_HOLD_DAYS` is deleted from both files.

- [ ] **Step 1: Rewrite the test file to assert the new invariant**

```javascript
// apps/web/src/lib/server/__tests__/pendingReviewAccess.test.mjs
/**
 * Recording a payment must not change entitlement.
 *
 * This used to require special-casing: 'pending_review' was written into
 * subscription_status, so planStatus() had to detect it and reconstruct the
 * access the write had just destroyed. With payment_state separate there is
 * nothing to reconstruct — planStatus does not know reviews exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStatus } from '../../plan.js';

const DAY = 86400000;
const future = d => new Date(Date.now() + d * DAY).toISOString();
const past = d => new Date(Date.now() - d * DAY).toISOString();

test('payment_state never changes entitlement', () => {
  const base = { plan_tier: 'free', subscription_status: 'trial', trial_ends_at: future(20) };
  const expected = planStatus(base).isPro;
  for (const s of [null, 'awaiting_proof', 'in_review', 'verifying', 'rejected']) {
    assert.equal(planStatus({ ...base, payment_state: s }).isPro, expected,
      `payment_state '${s}' altered entitlement`);
  }
});

test('a trialing shop that uploads proof is still on trial', () => {
  const b = { plan_tier: 'free', subscription_status: 'trial', trial_ends_at: future(20), payment_state: 'in_review' };
  assert.equal(planStatus(b).isPro, true);
  assert.equal(planStatus(b).onTrial, true);
  assert.ok(planStatus(b).trialDaysLeft > 0);
});

test('an expired shop is not rescued by having a payment in review', () => {
  const b = { plan_tier: 'free', subscription_status: 'expired', trial_ends_at: past(40), payment_state: 'in_review' };
  assert.equal(planStatus(b).isPro, false);
});

test('planStatus no longer mentions reviews at all', async () => {
  const { readFileSync } = await import('node:fs');
  const root = process.cwd().replace(/apps[\\/]web$/, '');
  for (const p of ['apps/web/src/lib/plan.js', 'packages/shared/plan.js']) {
    const src = readFileSync(`${root}${p}`, 'utf8');
    const fn = src.match(/function planStatus\(business\)[\s\S]*?\n\}/)[0];
    assert.ok(!/pending_review|inReview|reviewSub|asOf|REVIEW_HOLD/.test(fn),
      `${p} still special-cases reviews`);
  }
});

test('the bot and the mini-app agree about who is Pro', async () => {
  const shared = await import('../../../../../../packages/shared/plan.js');
  const cases = [
    { plan_tier: 'free', subscription_status: 'trial', trial_ends_at: future(3) },
    { plan_tier: 'free', subscription_status: 'trial', trial_ends_at: past(1) },
    { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: future(10) },
    { plan_tier: 'free', subscription_status: 'active', subscription_expires_at: past(5) },
    { plan_tier: 'free', subscription_status: 'expired', payment_state: 'in_review' },
    { plan_tier: 'pro', subscription_status: 'expired' },
  ];
  for (const biz of cases) {
    assert.equal(shared.planStatus(biz).isPro, planStatus(biz).isPro,
      `mirrors disagree for ${JSON.stringify(biz)}`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/pendingReviewAccess.test.mjs`
Expected: FAIL on "planStatus no longer mentions reviews at all" — the function still contains `inReview`.

- [ ] **Step 3: Simplify `planStatus` in `apps/web/src/lib/plan.js`**

Replace the review block with the original two lines:

```javascript
  const activeSub = status === 'active' && (!expiresAt || expiresAt > now);
  const onTrial   = status === 'trial' && trialEnds > now;
  const isPro     = tier === 'pro' || activeSub || onTrial;
  const trialDaysLeft = onTrial ? Math.max(0, Math.ceil((trialEnds - now) / 86400000)) : 0;
  const expired   = !isPro && (status === 'expired' || status === 'cancelled' || (status === 'trial' && trialEnds && trialEnds <= now));
```

Delete the `submittedAt`/`holding`/`asOf`/`inReview`/`reviewSub` lines and the `REVIEW_HOLD_DAYS` export with its doc comment.

- [ ] **Step 4: Apply the identical change to `packages/shared/plan.js`**

Same five lines, plus delete the `REVIEW_HOLD_DAYS` const and its entry in `module.exports`.

- [ ] **Step 5: Run the full suite**

Run: `cd apps/web && npm test`
Expected: PASS. `paymentGrantGuards.test.mjs` asserts `expiresAt > asOf` — update that assertion to `expiresAt > now` as part of this step.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/plan.js packages/shared/plan.js apps/web/src/lib/server/__tests__/pendingReviewAccess.test.mjs apps/web/src/lib/server/__tests__/paymentGrantGuards.test.mjs
git commit -m "payments: planStatus answers entitlement only"
```

---

### Task 3: Writers record payment progress, not entitlement

**Files:**
- Modify: `apps/web/src/app/api/payment/subscribe/proof/route.js` (the verify.et queued branch and the fallback `updates` object)
- Modify: `apps/web/src/lib/server/paymentVerification.js:99-126` (both verdict branches)
- Test: `apps/web/src/lib/server/__tests__/paymentGrantGuards.test.mjs` (extend)

**Interfaces:**
- Consumes: `payment_state` column from Task 1; simplified `planStatus` from Task 2.
- Produces: no new exports. Invariant: no file under `app/api/payment/**` writes `subscription_status`.

- [ ] **Step 1: Write the failing test**

```javascript
// append to apps/web/src/lib/server/__tests__/paymentGrantGuards.test.mjs

test('the payment routes never write entitlement', () => {
  // Recording a payment is not an entitlement decision. Approval is.
  for (const [name, src] of [['proof', proof], ['verification', read('lib/server/paymentVerification.js')]]) {
    const code = stripComments(src);
    const writes = code.match(/subscription_status:\s*'[a-z_]+'/g) || [];
    const illegal = writes.filter(w => !/'active'/.test(w));
    assert.deepEqual(illegal, [],
      `${name} writes entitlement while recording a payment: ${illegal}`);
    assert.ok(!/'pending_review'/.test(code), `${name} still uses pending_review`);
  }
});

test('an uploaded proof sets payment_state', () => {
  const code = stripComments(proof);
  assert.match(code, /payment_state: 'in_review'/);
  assert.match(code, /payment_state: 'verifying'/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/paymentGrantGuards.test.mjs`
Expected: FAIL — proof route still writes `subscription_status: 'pending_review'`.

- [ ] **Step 3: Update the proof route**

In the verify.et queued branch, replace `subscription_status: 'pending_review'` with `payment_state: 'verifying'`. In the fallback `updates` object, replace it with `payment_state: 'in_review'`. Keep `payment_submitted_at` — it still records when the review opened, for the queue ordering in Task 4. Delete the `reviewAnchor` block and use `now.toISOString()` directly: with entitlement untouched by review, a refreshed timestamp no longer extends anything.

- [ ] **Step 4: Update `paymentVerification.js`**

Accept branch: keep `subscription_status: 'active'` (this IS an entitlement decision), and add `payment_state: null`. Reject branch: remove `subscription_status: 'pending_review'` entirely and set `payment_state: 'in_review'` — a failed automated check hands the payment to a human without touching access.

- [ ] **Step 5: Run the full suite**

Run: `cd apps/web && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/payment apps/web/src/lib/server/paymentVerification.js apps/web/src/lib/server/__tests__/paymentGrantGuards.test.mjs
git commit -m "payments: recording a payment no longer writes entitlement"
```

---

### Task 4: The review queue reads the new column

**Files:**
- Modify: `apps/web/src/app/api/cron/stale-reviews/route.js:70-76`
- Modify: `apps/web/src/app/api/admin/overview/route.js:174`
- Modify: `apps/web/src/app/api/admin/pulse/route.js:141`
- Modify: `apps/web/src/app/admin/page.js:2733`
- Test: `apps/web/src/lib/server/__tests__/paymentLifecycle.test.mjs` (extend)

**Interfaces:**
- Consumes: `isAwaitingDecision` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

```javascript
// append to apps/web/src/lib/server/__tests__/paymentLifecycle.test.mjs
import { readFileSync } from 'node:fs';
const root = process.cwd().replace(/apps[\\/]web$/, '');
const readSrc = p => readFileSync(`${root}apps/web/src/${p}`, 'utf8');

test('every review queue reads payment_state, not subscription_status', () => {
  const queues = [
    'app/api/cron/stale-reviews/route.js',
    'app/api/admin/overview/route.js',
    'app/api/admin/pulse/route.js',
  ];
  for (const p of queues) {
    const src = readSrc(p);
    assert.ok(!/pending_review/.test(src), `${p} still queues on pending_review`);
    assert.match(src, /payment_state/, `${p} does not read payment_state`);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/paymentLifecycle.test.mjs`
Expected: FAIL — `stale-reviews` still filters `.eq('subscription_status', 'pending_review')`.

- [ ] **Step 3: Update each queue**

`stale-reviews/route.js`: change `.eq('subscription_status', 'pending_review')` to `.in('payment_state', ['in_review', 'verifying'])`, and add `payment_state` to the `.select()`.

`admin/overview/route.js:174`: change the `.or(...)` to `.or('payment_state.in.(in_review,verifying),and(payment_proof_url.not.is.null,payment_verified.eq.false)')`.

`admin/pulse/route.js:141`: change `.eq('subscription_status', 'pending_review')` to `.in('payment_state', ['in_review', 'verifying'])`.

`admin/page.js:2733`: change `p.subscription_status === 'pending_review'` to `isAwaitingDecision(p)`, importing from `../../lib/paymentLifecycle`.

- [ ] **Step 4: Run the full suite**

Run: `cd apps/web && npm test`
Expected: PASS

- [ ] **Step 5: Verify the build**

Run: `cd apps/web && npm run build`
Expected: `✓ Compiled successfully`, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app
git commit -m "payments: review queues read payment_state"
```

---

### Task 5: Decisions clear the lifecycle, and the enum closes

**Files:**
- Modify: `apps/web/src/app/api/admin/businesses/[id]/route.js:98` (status enum) and the decision block
- Modify: `apps/web/src/lib/server/replyEngine.js` (the `sub_approve_`/`sub_reject_` handler)
- Modify: `apps/web/src/lib/paymentState.js` (add the `in_review` bucket)
- Test: `apps/web/src/lib/server/__tests__/paymentGrantGuards.test.mjs` (extend)

**Interfaces:**
- Consumes: `payment_state`, `isAwaitingDecision`.
- Produces: `paymentState(business, paymentCount)` gains a possible return value of `'in_review'`, inserted between `'claimed'` and `'granted'` in `PAYMENT_STATES`.

- [ ] **Step 1: Write the failing test**

```javascript
// append to apps/web/src/lib/server/__tests__/paymentGrantGuards.test.mjs

test('pending_review is no longer an accepted entitlement value', () => {
  const code = stripComments(bizPatch);
  const enumLine = code.match(/oneOf\(body\.subscription_status,[^)]+\)/)[0];
  assert.ok(!/pending_review/.test(enumLine),
    'the admin API still accepts pending_review as a subscription_status');
});

test('approving or rejecting clears the payment lifecycle', () => {
  const engine = stripComments(read('lib/server/replyEngine.js'));
  const at = engine.indexOf("data.startsWith('sub_approve_')");
  const block = engine.slice(at, at + 3000);
  const clears = block.match(/payment_state: null/g) || [];
  assert.equal(clears.length, 2, 'both approve and reject must clear payment_state');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && node --test src/lib/server/__tests__/paymentGrantGuards.test.mjs`
Expected: FAIL — the enum still lists `pending_review`.

- [ ] **Step 3: Close the enum and clear on decision**

In `[id]/route.js:98`, remove `'pending_review'` from the `oneOf` list. Replace the "moving off pending_review" block with: when `subscription_status` is being set to any value, also set `updates.payment_state = null` — a decision on access is a decision on the payment.

In `replyEngine.js`, in both the approve and reject `updates` objects, replace `payment_submitted_at: null` with `payment_submitted_at: null, payment_state: null`.

- [ ] **Step 4: Add the `in_review` bucket to `paymentState()`**

```javascript
// apps/web/src/lib/paymentState.js — inside paymentState(), before the granted check
  // A payment waiting on a decision is its own thing: not yet revenue, but not
  // an unpaid grant either. Reported separately so the funnel does not count a
  // merchant who has paid among the people who never did.
  if (business.payment_state === 'in_review' || business.payment_state === 'verifying') {
    return 'in_review';
  }
```

Add `'in_review'` to `PAYMENT_STATES` after `'claimed'`, and to `PAYMENT_STATE_LABELS`:

```javascript
  in_review: { label: 'In review', tone: 'warn', hint: 'Proof uploaded, waiting on a decision' },
```

- [ ] **Step 5: Run the full suite and build**

Run: `cd apps/web && npm test && npm run build`
Expected: PASS, `✓ Compiled successfully`

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "payments: decisions clear the lifecycle; pending_review retired"
```

---

### Task 6: Remove the compensating machinery

**Files:**
- Modify: `apps/web/src/app/api/payment/subscribe/proof/route.js` (delete `updateTolerantly` if nothing else needs it)
- Modify: `supabase/migrations/payment_submitted_at.sql` — leave as-is (historical record), but update its comment
- Test: `apps/web/src/lib/server/__tests__/paymentGrantGuards.test.mjs` (prune obsolete assertions)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing. This task only deletes.

- [ ] **Step 1: Delete the obsolete tests**

Remove from `paymentGrantGuards.test.mjs`: `'re-uploading cannot extend the review hold'`. The hold no longer exists, so the test asserts against deleted code. Keep every other test in the file.

- [ ] **Step 2: Run the suite to confirm what still depends on the hold**

Run: `cd apps/web && npm test`
Expected: PASS. Any failure names a file still reading `REVIEW_HOLD_DAYS` or `reviewAnchor` — fix those before continuing.

- [ ] **Step 3: Confirm nothing references the removed symbols**

Run: `grep -rn "REVIEW_HOLD_DAYS\|reviewAnchor\|pending_review" apps packages --include=*.js --include=*.mjs | grep -v node_modules | grep -v .next`
Expected: only `supabase/migrations/*.sql` (historical) and the migration comments.

- [ ] **Step 4: Keep `payment_submitted_at`, repurposed**

It is no longer a hold anchor but it is still the only record of *when* a review opened, which `stale-reviews` uses to age the queue. Update the column comment:

```sql
comment on column businesses.payment_submitted_at is
  'When the current payment review opened. Queue ordering and ageing only — has no effect on entitlement.';
```

Add this as `supabase/migrations/payment_submitted_at_recomment.sql`.

- [ ] **Step 5: Full verification**

Run: `cd apps/web && npm test && npm run build`
Expected: PASS, `✓ Compiled successfully`

- [ ] **Step 6: Commit**

```bash
git add apps/web supabase/migrations
git commit -m "payments: remove the review-hold machinery the separation obsoletes"
```

---

## Rollout Order

The migration widens before it narrows, so code and schema can be deployed in either order **except** the enum constraint:

1. Apply `payment_state.sql` **except** the `businesses_subscription_status_check` statement.
2. Deploy the code (Tasks 2–6).
3. Confirm no row has `subscription_status = 'pending_review'`:
   `select count(*) from businesses where subscription_status = 'pending_review';` → expect 0.
4. Apply the `businesses_subscription_status_check` constraint.

Doing step 4 first would reject writes from the old code still running during the deploy.

## Verification

After rollout, the separation invariant should hold as a live query — no row may have a payment in flight and a broken entitlement:

```sql
select count(*) from businesses
where payment_state in ('in_review','verifying')
  and subscription_status not in ('trial','active','expired','cancelled');
```

Expect 0. If it is ever non-zero, a writer is still fusing the two.
