-- Migration 028: 30-day trial backfill + search-visibility safety net
--
-- 1) The free trial went from 14 days to 30 ("1 month free, everything
--    unlocked"). TRIAL_DAYS is fixed in code for NEW activations, but shops
--    already mid-trial still carry a 14-day trial_ends_at. Extend them so
--    nobody who signed up under the old copy gets a shorter month than the
--    people who signed up a day later.
--    Only touches rows still in 'trial' — never revives an expired shop and
--    never shortens a trial that is already longer than 30 days.
UPDATE businesses
SET    trial_ends_at = trial_started_at + INTERVAL '30 days'
WHERE  subscription_status = 'trial'
  AND  trial_started_at IS NOT NULL
  AND  trial_ends_at < trial_started_at + INTERVAL '30 days';

-- 2) Search visibility safety net. b2b_discoverable already DEFAULTs to true
--    (supabase/migrations/business_messages.sql) and legacy NULLs were handled
--    once before, but a NULL here makes a shop silently invisible in MiniMe
--    Search — the owner sees no error, they just never appear. Re-assert it for
--    any onboarded shop that is still NULL. Explicit `false` (an owner who
--    deliberately opted out in Settings → Network) is preserved.
UPDATE businesses
SET    b2b_discoverable = true
WHERE  b2b_discoverable IS NULL
  AND  onboarding_completed = true;

-- 3) Repair search_logs — SILENT DATA LOSS BUG.
--    lib/server/searchBot.js inserts `used_gpt` and `via`, but neither column
--    exists (see supabase/migrations/minime_search.sql). PostgREST rejects the
--    whole row, and the insert is wrapped in a bare `.catch(() => {})`, so every
--    search the Telegram bot has ever served was dropped on the floor without a
--    single log line. That starved demand.js unmetDemand()/searchAbandonment()
--    — the "N people searched for X and found nothing" intelligence owners see
--    in Analytics has been permanently empty.
--    Adding the columns fixes logging going forward. Historical searches are
--    unrecoverable.
ALTER TABLE search_logs
  ADD COLUMN IF NOT EXISTS used_gpt BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS via      TEXT;

-- Useful for the unmetDemand() scan (results_count = 0 over a date window).
CREATE INDEX IF NOT EXISTS idx_search_logs_unmet
  ON search_logs(created_at DESC) WHERE results_count = 0;
