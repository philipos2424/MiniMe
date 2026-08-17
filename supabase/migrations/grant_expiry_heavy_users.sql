-- Put an expiry on the 26 heaviest granted-unpaid accounts.
--
-- Context: 624 businesses carry plan_tier='pro' with no payment on record.
-- planStatus() (apps/web/src/lib/plan.js) returns isPro on tier==='pro' alone,
-- ignoring subscription_expires_at entirely, so those accounts have permanent
-- free Pro and no reason to ever pay. Revenue collected to date: 0 ETB.
--
-- We are NOT fixing planStatus() to respect expiry. That looks like the tidier
-- fix and it is a trap: most of the 624 already carry a PAST expires_at (the
-- 2026-08-04 bulk grant), so tightening the function would revoke ~600 accounts
-- the instant it deployed. Instead we move this cohort into the state that
-- already works correctly today — plan_tier='free' with a live subscription
-- window — which is exactly the state Creator Nova and FIKR STIKERS are in.
-- Same semantics, no code change, blast radius of 26 rows.
--
-- Scope: plan_tier='pro' AND >=20 messages AND active in the last 30 days.
-- These are the merchants who actually use the product daily and would feel
-- its absence. The other ~550 granted accounts are dead signups; revoking them
-- earns nothing and generates support noise, so they are left alone.
--
-- SEQUENCING — THIS MATTERS:
--   1. Run this script. Nobody loses access today; the window is 14 days.
--   2. Send the notice broadcast the SAME DAY via /admin → notify owners
--      (business_ids = the list below, dry_run first).
--   3. Send a second reminder 3 days before the window closes.
-- Running step 1 without step 2 silently cuts off 26 paying-candidate
-- merchants in two weeks with no warning. Do not leave this half-done.

begin;

-- Exact prior state, so the rollback at the bottom is a real rollback and not
-- a guess. Kept as a table rather than in comments because plan_tier is not
-- the only field we touch.
create table if not exists grant_expiry_backup_20260816 as
select id, plan_tier, subscription_plan, subscription_status, subscription_expires_at
from businesses
where false;

insert into grant_expiry_backup_20260816
select id, plan_tier, subscription_plan, subscription_status, subscription_expires_at
from businesses
where id in (
  -- name (owner) — lifetime messages
  'fe5b15d8-2296-4a64-829a-62bc66d50448',  -- State-Commerce (Yonathan Wondwossen) — 190
  'c8d7df4a-74ca-4ccd-982b-738fa3d1b323',  -- Joshop (ዮሐንስ) — 144
  '2e342856-3b51-42d6-bebd-227335502ac5',  -- Jack Digitals — 105
  'fba7957a-9757-48d9-8e8d-2de6f1f64419',  -- yonas shop — 95
  'dc308dcb-8d07-4307-93db-02522adfdccd',  -- Bebanya pic (Sari) — 75  [trial runs to 2026-08-31]
  '7cd51d35-2a63-485f-b577-f81be0a7ef4b',  -- H (Omera Digital Solutions) — 67
  '56a59437-936c-4876-bb73-b0fdbaa919a7',  -- Tekalign Telbirr — 63
  '763f0910-05cc-4c86-af82-980c3b89dc44',  -- Maraki online shop (Yabu) — 62
  '29f43b17-90dc-4703-919e-71a8c01ab332',  -- Ararso Dev — 46
  '119ad5b6-84b0-43d9-91b1-c2ed02607362',  -- Beso online shop — 31
  '384ee260-0254-449c-ac89-93faeb6cfaeb',  -- Ahmed garment accessories — 30
  '8da3050d-e657-434e-a78b-a2156db64a05',  -- Eskendir gym trainer — 29
  '00242045-49cd-4aa7-90d4-abd11a15805d',  -- Eximman.tech (Aboudy Kimo) — 28
  '1b109fe3-974e-4d3f-b996-7614f2ba9cb8',  -- Gursha (Eyoel Tesfaye) — 27
  '1f7a3d79-0659-4701-9a09-9c3bc02039f0',  -- Pixel Garden (hakeem) — 26
  '0d65b1c8-e12d-45d5-917c-6ec6beb71a92',  -- Mahi ሱቅ (መና) — 25
  '94a3b51b-2f39-4da6-a029-8fd9dc995187',  -- Amanuel marketing — 24
  '703d6b8f-0ed1-40c1-9b17-6bc8a5855a72',  -- Bizvoke (Eya) — 24
  '922745d5-2016-4ff5-a387-444608597748',  -- Ruth — 22
  'f7885ff7-9918-4aa5-89db-12c3839a86b7',  -- PowerT marketing (Daniel) — 22
  'd062cc76-b230-4c95-bf9b-04ed1326ed0f',  -- Gabriel sales — 21
  '426de139-9ddc-43a7-829c-d87ffd98a1a7',  -- fayda support — 20

  -- ⚠ REVIEW BEFORE RUNNING. These four have 20+ real messages so they are not
  -- obviously junk, but the shop names read like throwaways. If any is your own
  -- test account, delete its line — messaging yourself an expiry warning is
  -- harmless, but it pollutes the conversion numbers you are about to read.
  '719aa17a-f3f4-426f-ac0e-24f13df9109d',  -- "test" (MIKIYAS) — 28
  '8ebdac41-b411-4219-b592-d9619efe04db',  -- "h" (Abel) — 27
  'b327a05e-8c6a-4633-a532-1d821fd087cb',  -- "Hi" (𝓪𝓼𝓻𝓪𝓽) — 25
  'c6a1bc7d-a3a6-45a0-af8b-b0a48e8158b0'   -- "Gg" (BINIYAM) — 22
)
and not exists (select 1 from grant_expiry_backup_20260816 b where b.id = businesses.id);

update businesses b
set plan_tier = 'free',              -- drops the unconditional isPro short-circuit
    subscription_plan = 'pro',       -- what they'd be renewing INTO, for the upgrade UI
    subscription_status = 'active',  -- still Pro until the window below closes
    -- 14 days, except never cut an unexpired trial short — Bebanya pic is
    -- mid-trial to 2026-08-31 and must keep every day of it.
    subscription_expires_at = greatest(
      now() + interval '14 days',
      coalesce(b.trial_ends_at, now())
    )
from grant_expiry_backup_20260816 k
where b.id = k.id;

-- Expect 26 (or fewer if you deleted flagged lines above).
select count(*) as rows_updated,
       min(subscription_expires_at)::date as window_opens_closing,
       max(subscription_expires_at)::date as last_to_lapse
from businesses
where id in (select id from grant_expiry_backup_20260816);

commit;

-- ── ROLLBACK ────────────────────────────────────────────────────────────────
-- Restores every field exactly as it was. Safe to run at any point.
--
-- update businesses b
-- set plan_tier               = k.plan_tier,
--     subscription_plan       = k.subscription_plan,
--     subscription_status     = k.subscription_status,
--     subscription_expires_at = k.subscription_expires_at
-- from grant_expiry_backup_20260816 k
-- where b.id = k.id;
