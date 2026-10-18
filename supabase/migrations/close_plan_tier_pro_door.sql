-- Close the plan_tier='pro' door: free Pro forever for the August bulk grant.
--
-- Supersedes grant_expiry_heavy_users.sql, which was written on 2026-08-16 for
-- exactly this and never ran (its backup table does not exist in prod).
--
-- State on 2026-10-17, before this ran:
--   • 611 of 1,235 businesses carry plan_tier='pro'. planStatus() honours that
--     unconditionally, so none of them can ever see the paywall.
--   • ~598 of them sit on subscription windows that closed June–Sept 2026
--     (593 in August). No confirmed payment exists for any of the 611.
--   • 22 sent or received messages in the last 30 days. The rest are dead.
--
-- The fix stays in the data, not the code. Making planStatus() respect expiry
-- would revoke all 611 at deploy with no notice. Instead every row moves to the
-- state that already works: plan_tier='free' plus a dated window. This is what
-- every lapsed trial is in, and what cron/grant-lapse and the trial_stage
-- outreach ladder already handle.
--
--   A. ACTIVE (messages in the last 30 days): 14-day window, never shorter than
--      an unexpired trial. trial_warn_stage is reset so the existing ladder
--      (cron/outreach-rules: 7 → 3 → 1 → 0 → -7 → -30) warns them and then
--      asks them to pay. Nobody loses anything today.
--      Caveat: the ladder only reaches owners with owner_private_chat_id
--      (7 of the 21). The other 15 need a personal message.
--
--   B. INACTIVE: dropped to Free now. Their windows closed months ago and no
--      one is using them. trial_warn_stage is set to the final rung (-30)
--      wherever access has already ended, so the ladder does NOT fire ~580
--      "your free month is over" messages at dead signups in one night.
--      Anyone who comes back meets the paywall, which is the point.
--
--   EXCLUDED: Digital drift marketing (e0316979…). It has a payment proof
--   queued for review (payment_verifications.state='queued',
--   payment_state='verifying'). It might be the first paying customer, so
--   nothing here touches it.
--
-- Rollback at the bottom restores every touched field exactly.

begin;

create table if not exists plan_tier_door_backup_20261017 as
select id, plan_tier, subscription_plan, subscription_status,
       subscription_expires_at, trial_warn_stage,
       null::text as cohort
from businesses where false;

insert into plan_tier_door_backup_20261017
select b.id, b.plan_tier, b.subscription_plan, b.subscription_status,
       b.subscription_expires_at, b.trial_warn_stage,
       case when exists (
         select 1 from messages m
         where m.business_id = b.id and m.created_at > now() - interval '30 days'
       ) then 'A_active' else 'B_inactive' end
from businesses b
where b.plan_tier = 'pro'
  and b.id <> 'e0316979-7d55-4844-86b7-99a822c3dab0'      -- payment under review
  and coalesce(b.payment_state, '') <> 'verifying'          -- and anyone else mid-review
  and not exists (select 1 from plan_tier_door_backup_20261017 k where k.id = b.id);

-- A. Active: a dated runway, and the warning ladder re-armed.
update businesses b
set plan_tier               = 'free',
    subscription_plan       = 'pro',     -- what they renew into, for the upgrade UI
    subscription_status     = 'active',
    subscription_expires_at = greatest(now() + interval '14 days',
                                       coalesce(b.trial_ends_at, now())),
    trial_warn_stage        = null
from plan_tier_door_backup_20261017 k
where b.id = k.id and k.cohort = 'A_active';

-- B. Inactive: Free now, and silenced wherever access has already ended.
update businesses b
set plan_tier        = 'free',
    trial_warn_stage = case
      when greatest(coalesce(b.trial_ends_at, '-infinity'),
                    coalesce(b.subscription_expires_at, '-infinity')) <= now()
      then -30 else b.trial_warn_stage end
from plan_tier_door_backup_20261017 k
where b.id = k.id and k.cohort = 'B_inactive';

select k.cohort, count(*) as rows,
       min(b.subscription_expires_at)::date as earliest_window_end,
       max(b.subscription_expires_at)::date as latest_window_end,
       count(*) filter (where b.trial_warn_stage = -30) as silenced
from plan_tier_door_backup_20261017 k join businesses b on b.id = k.id
group by 1 order by 1;

commit;

-- ── FOLLOW-UPS applied the same day (2026-10-17) ────────────────────────────
-- • Digital drift marketing: the "queued" proof turned out to be a bank
--   reference of `Ftweghhggg`, queued on 2026-08-30 and never answered by
--   verify.et. It is not a payment. The shop was given the cohort-A treatment
--   (Pro until 2026-10-31, ladder re-armed) and payment_state='rejected'.
--   Backed up as cohort 'A_active_late', including payment_state (a column
--   added to the backup table for this row).
-- • Amanuel Business Operations (383b6cd7…): active + NULL expiry, the last
--   row main's planStatus still read as permanent Pro. Its trial ended
--   2026-05-31, so subscription_status was set to 'expired'.
--   ⚠ This id has TWO backup rows. The original state is the row with cohort
--   'B_inactive+C_null_expiry'. The 'C_null_expiry' row is a post-migration
--   snapshot, so exclude it from any rollback:  and k.cohort <> 'C_null_expiry'
--
-- ── CORRECTION 2026-10-18: the runway is a trial, not an active window ──────
-- Cohort A was given status='active' with a dated window. That is the state
-- feat/swap-barter's trialStage.mjs warns about, but production runs main.
-- main's cron/outreach-rules still has the inline evalTrialStage, which skips
-- every status='active' row and reads only trial_ends_at, so none of the 22
-- would have been warned. They were moved to status='trial' with
-- trial_ends_at = their window end (2026-10-31; Custom bot designer
-- 2026-11-12). Access is identical under both branches' planStatus.
-- Simulated against main's own cron code, the 7 owners with
-- owner_private_chat_id get day-7 (10-25), day-3 (10-29), day-1 (10-31) and
-- expired (11-01). The other 15 can't be reached by the bot.
-- Prior trial_ends_at and status are kept in the backup columns
-- trial_ends_at_before_1018 and status_before_1018.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- update businesses b
-- set plan_tier               = k.plan_tier,
--     subscription_plan       = k.subscription_plan,
--     subscription_status     = k.subscription_status,
--     subscription_expires_at = k.subscription_expires_at,
--     trial_warn_stage        = k.trial_warn_stage,
--     payment_state           = coalesce(k.payment_state, b.payment_state)
-- from plan_tier_door_backup_20261017 k
-- where b.id = k.id and k.cohort <> 'C_null_expiry';
-- update businesses b
-- set trial_ends_at = k.trial_ends_at_before_1018
-- from plan_tier_door_backup_20261017 k
-- where b.id = k.id and k.status_before_1018 is not null;
