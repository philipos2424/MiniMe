-- Close the second free-Pro door: subscription_status='active' with no expiry.
--
-- planStatus() (apps/web/src/lib/plan.js) reads:
--
--   const activeSub = status === 'active' && (!expiresAt || expiresAt > now);
--
-- A NULL subscription_expires_at therefore means permanent Pro, not expired.
-- 31 accounts currently hold Pro through that clause alone. They were created
-- by the bare "✅ Activate" admin button, which wrote subscription_status
-- without any expiry — PR #16 fixes the button (the route now defaults to a
-- 30-day window), but the rows it already made keep their permanent grant, and
-- planStatus keeps honouring it.
--
-- WHY A WINDOW RATHER THAN JUST FIXING THE READ:
-- Tightening plan.js on its own revokes all 31 the instant it deploys, with no
-- warning. 8 of them are active merchants, and one is Ethio Freshman — 346
-- messages in 30 days, roughly a third of all traffic on the platform. Silently
-- cutting off the shop that uses this product most, to fix our own bookkeeping
-- error, is not an acceptable way to start charging people. This is the same
-- trap grant_expiry_heavy_users.sql documents for plan_tier.
--
-- So: give every affected row a real, dated window first. Nobody's access
-- changes today. The code fix then becomes a no-op for these rows, and they
-- reach Free by the window lapsing — which is a thing we can warn about.
--
-- The dormant 23 get the same window. They are not worth a notice (a dead
-- signup revoked earns nothing and generates support noise) but they must not
-- be left on the permanent grant either, or the code fix cuts them off later
-- for no reason. A window they never notice is the honest middle.
--
-- ROLLOUT ORDER — THIS MATTERS:
--   1. Run this script. Nobody loses access today; the window is 14 days.
--   2. Send the notice to the 8 ACTIVE shops the SAME DAY (see list below),
--      via /admin → notify owners, dry_run first.
--   3. Deploy the plan.js fix. Still no change — every row now has a live
--      window, so the tightened read returns exactly what it did before.
--   4. Send a reminder 3 days before the window closes.
--
-- Running step 1 without step 2 gives 8 working merchants two weeks of silence
-- and then a downgrade. Do not leave this half-done.
--
-- WHAT LAPSING ACTUALLY COSTS THEM: autonomy, not service. On Free MiniMe still
-- reads every message and still writes every reply — the owner taps send
-- instead of it going out by itself (lib/plan.js, FREE_MAX_TRUST_LEVEL).
-- effectiveTrustLevel() caps at read time and never writes the row, so their
-- chosen setting is preserved and upgrading restores it instantly.
--
-- Safe to run twice: the WHERE clause stops matching once a window is set.

begin;

-- The cohort: Pro solely because of the null-expiry clause. plan_tier='pro'
-- rows are excluded — planStatus honours that tier unconditionally, so a window
-- would change nothing for them. That door is grant_expiry_heavy_users.sql's
-- job, deliberately kept as a separate decision.
update businesses
set subscription_expires_at = now() + interval '14 days'
where subscription_status = 'active'
  and subscription_expires_at is null
  and coalesce(plan_tier, 'free') <> 'pro';

commit;

-- ── Verify before sending the notice ────────────────────────────────────────
--
-- Expect 0 — no account should still be Pro via a null expiry:
--
--   select count(*) from businesses
--   where subscription_status = 'active'
--     and subscription_expires_at is null
--     and coalesce(plan_tier, 'free') <> 'pro';
--
-- Expect 31, all dated 14 days out:
--
--   select name, subscription_expires_at from businesses
--   where subscription_status = 'active'
--     and coalesce(plan_tier, 'free') <> 'pro'
--     and subscription_expires_at > now()
--   order by subscription_expires_at;
--
-- The 8 that need the notice (active in the last 30 days), at time of writing:
--
--   Ethio Freshman · Ozone Technology PLC · ll · N.H.B DIGITALS ·
--   Kality gumuruk · CartEt · Bole tech · Hiwot's Business
--
-- Re-derive rather than trusting that list if time has passed:
--
--   select b.id, b.name, count(m.id) as msgs
--   from businesses b join messages m on m.business_id = b.id
--   where b.subscription_status = 'active'
--     and coalesce(b.plan_tier, 'free') <> 'pro'
--     and b.subscription_expires_at > now()
--     and m.created_at > now() - interval '30 days'
--   group by b.id, b.name
--   order by msgs desc;
