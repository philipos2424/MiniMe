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
-- ROLLOUT ORDER MATTERS. Run everything here EXCEPT the final
-- businesses_subscription_status_check block, deploy the code, confirm no row
-- still reads 'pending_review', and only then add the constraint. Adding it
-- first would reject writes from the old code still serving during the deploy.
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
--
-- plan_tier='pro' rows are unaffected by the choice either way — planStatus()
-- honours that tier unconditionally, so 'expired' costs them nothing.
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

create index if not exists businesses_payment_state_idx
  on businesses (payment_state) where payment_state is not null;

comment on column businesses.payment_state is
  'Payment lifecycle only. Never read this to decide entitlement — see subscription_status.';


-- ── RUN THIS PART ONLY AFTER THE CODE IS DEPLOYED ──────────────────────────
-- Verify first:
--   select count(*) from businesses where subscription_status = 'pending_review';
-- Expect 0, then:
--
-- alter table businesses
--   drop constraint if exists businesses_subscription_status_check;
-- alter table businesses
--   add constraint businesses_subscription_status_check
--   check (subscription_status in ('trial', 'active', 'expired', 'cancelled'));
