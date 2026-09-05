-- Migration 051: make four columns stop lying.
--
-- Context: the August 2026 retention collapse. 543 comped Pro grants expired
-- in the week of 3 August; the shops correctly lost Pro and were told nothing,
-- because every signal we had about them was wrong. Reconstructing what
-- happened took a scan of raw message timestamps, because not one of the
-- columns meant to record it held a true value.
--
-- Nothing here changes any owner's entitlement. planStatus() (apps/web/src/
-- lib/plan.js) already reads the dates and already treats every row touched
-- below as Free. This migration writes down what is already true.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Date the undated grants.
--
-- 54 shops sit on subscription_status='active' with subscription_expires_at
-- NULL. planStatus() refuses to call that Pro (see nullExpiryEntitlement.test
-- .mjs — a NULL window once meant permanent free Pro for 31 accounts, and that
-- door was closed), so these rows are already Free in every way that matters.
-- They just carry no date, which means cron/grant-lapse cannot reconcile them
-- and cron/outreach-rules cannot stage a notice for them: they are invisible,
-- permanently.
--
-- Give each one the date its access actually ran out. trial_ends_at where we
-- have it, otherwise 30 days from signup — the length every comp was granted.
--
-- An account genuinely meant to keep Pro is marked plan_tier='pro', which
-- planStatus() honours unconditionally and which this does not touch. If any
-- of the 54 belongs in that group, set plan_tier='pro' on it rather than
-- reverting this.
UPDATE businesses
SET    subscription_expires_at = COALESCE(trial_ends_at, created_at + INTERVAL '30 days')
WHERE  subscription_status = 'active'
  AND  subscription_expires_at IS NULL
  AND  COALESCE(plan_tier, subscription_plan) IS DISTINCT FROM 'pro';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. secretary_connected: a default masquerading as a signal.
--
-- true on all 956 rows while last_secretary_activity is NULL on all 956 and
-- secretary_chat_id is set on exactly 1. No code has ever written it. The real
-- test is whether a Telegram Business connection exists, which is what
-- api/admin/check-secretary already computes on the fly:
--   secretary_connected: !!b.telegram_biz_conn_id
UPDATE businesses
SET    secretary_connected = (telegram_biz_conn_id IS NOT NULL);

ALTER TABLE businesses ALTER COLUMN secretary_connected SET DEFAULT false;

COMMENT ON COLUMN businesses.secretary_connected IS
  'Derived from telegram_biz_conn_id IS NOT NULL. Was DEFAULT true and never '
  'written by any code, so it read true for every row on the platform. Keep it '
  'in step wherever telegram_biz_conn_id is set or cleared, or read that column '
  'directly instead.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. onboarding_step: dead since the onboarding rewrite.
--
-- 0 on 953 of 956 rows. Nothing writes it; the real funnel is in
-- onboarding_events (welcome → shop_name → connect → …), which is where the
-- 503-reach-connect / 21-finish number comes from. Left in place because
-- several select lists name it, but marked so no one trusts it again.
COMMENT ON COLUMN businesses.onboarding_step IS
  'DEAD — always 0. Superseded by the onboarding_events table; query that for '
  'funnel position. Do not read this column.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Separate "the owner showed up" from "the shop is alive".
--
-- last_active_date is written in exactly one place: gamification.updateStreak(),
-- called only when an OWNER messages their OWN shop bot. 21 shops have ever
-- linked a shop bot, so the column is NULL for 732 shops that demonstrably
-- exchanged messages.
--
-- That would be harmless if it were only a streak counter, but two modules read
-- it as a liveness signal: b2bAudience.activityTier() (which buckets a NULL as
-- 'never' and excludes the shop from outreach) and browseRank.activityLabel()
-- (which drives directory ranking). b2bAudience's own header reports "686 of
-- 887 businesses have never been active" — that number is this bug.
--
-- Backfilling last_active_date from message traffic would corrupt the streak,
-- since updateStreak() derives the day gap from it. So the two meanings get two
-- columns: last_active_date stays the owner's streak, and shop liveness moves
-- here.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS last_shop_activity_date DATE;

COMMENT ON COLUMN businesses.last_shop_activity_date IS
  'Last calendar day this shop exchanged any message, customer or owner. The '
  'liveness signal for outreach targeting and directory rank. Kept current by '
  'cron/activity-rollup. Distinct from last_active_date, which counts only the '
  'owner''s own visits and drives the streak.';

COMMENT ON COLUMN businesses.last_active_date IS
  'Owner streak only — the last day the OWNER messaged their own shop bot, '
  'written by gamification.updateStreak(). NOT a liveness signal: it is NULL '
  'for every shop that never linked its own bot. Use '
  'last_shop_activity_date for "is this shop alive".';

-- Backfill from the one record that was never wrong.
UPDATE businesses b
SET    last_shop_activity_date = m.last_day
FROM   (SELECT business_id, MAX(created_at)::date AS last_day
        FROM   messages
        GROUP  BY business_id) m
WHERE  m.business_id = b.id
  AND  (b.last_shop_activity_date IS NULL OR b.last_shop_activity_date < m.last_day);

-- activityTier()/activityLabel() bucket at 30 and 90 days; both scan on this.
CREATE INDEX IF NOT EXISTS idx_businesses_shop_activity
  ON businesses(last_shop_activity_date DESC NULLS LAST);
