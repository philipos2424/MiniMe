-- Migration 034: trial nudge staging + retire the free-tier credit cap
--
-- 1) Idempotent trial warnings.
--    cron/trial-checker.js matched the countdown with exact equality
--    (daysLeft === 3, === 1). One missed or delayed cron run and the owner
--    silently received NO warning at all before dropping to Free — the run
--    simply skipped past the matching day. Worse, two runs on the same day
--    sent the same nudge twice.
--    trial_warn_stage records the furthest warning already sent (7, 3, 1, 0),
--    so the checker can use >= thresholds and still send each stage once.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS trial_warn_stage INTEGER;

COMMENT ON COLUMN businesses.trial_warn_stage IS
  'Furthest trial nudge already sent: 7 | 3 | 1 | 0 (expired) | -7 | -30 (win-back). NULL = none sent.';

-- Shops already past a warning window must not get a retroactive burst of
-- nudges the first time the new checker runs. Treat anyone already inside the
-- 7-day window as having received the 7-day notice.
UPDATE businesses
SET    trial_warn_stage = 7
WHERE  subscription_status = 'trial'
  AND  trial_warn_stage IS NULL
  AND  trial_ends_at IS NOT NULL
  AND  trial_ends_at <= NOW() + INTERVAL '7 days';

-- Shops that expired BEFORE win-back nudges existed are marked fully-nudged
-- (-30). Otherwise the first run of the new checker would blast a "come back"
-- message at every shop that has ever lapsed, all at once.
UPDATE businesses
SET    trial_warn_stage = -30
WHERE  subscription_status IN ('expired', 'cancelled')
  AND  trial_warn_stage IS NULL;

-- 2) Free is FEATURE-gated, never usage-capped.
--    lib/plan.js has always said a free shop's core value — MiniMe answering
--    customers — is never blocked, but subscriptions rows created under the old
--    credit model carry credits_remaining = 50. When those hit 0 the billing
--    CreditStrategy returns allowed:false and the shop's customers stop getting
--    answered: a hard paywall on the one thing we promise never to gate.
--    -1 is the "unlimited" sentinel used by CreditStrategy.
UPDATE subscriptions
SET    credits_total = -1,
       credits_remaining = -1,
       updated_at = NOW()
WHERE  plan_name = 'free'
  AND  credits_remaining <> -1;

-- Paid legacy tiers (business/professional) keep their metering until those
-- subscriptions lapse; they are not sellable any more (PURCHASABLE_PLANS).
