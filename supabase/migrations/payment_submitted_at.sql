-- When a merchant submitted payment proof that is still awaiting review.
--
-- Proof uploads no longer activate anything — they go to pending_review and
-- wait for an admin to press Approve. That review time is ours, not the
-- merchant's, so planStatus() freezes their expiry at this timestamp while the
-- decision is outstanding: a shop that pays on the last day of its trial must
-- not lose access because nobody looked for two days.
--
-- Bounded by REVIEW_HOLD_DAYS (apps/web/src/lib/plan.js, currently 14). Past
-- that the hold lapses and the shop expires normally, so an upload nobody ever
-- reviews cannot become an indefinite free plan.
--
-- Safe to run at any time. Existing rows get NULL, which reads as "no hold" —
-- the behaviour that was already in place before this column existed.
-- api/payment/subscribe/proof tolerates the column being absent, so applying
-- this is not urgent, but the hold does nothing until it is applied.

alter table businesses
  add column if not exists payment_submitted_at timestamptz;

comment on column businesses.payment_submitted_at is
  'Set when payment proof enters pending_review; freezes plan expiry during review. Cleared on approval/rejection.';

-- Finds the review queue oldest-first, which is the order it should be worked.
create index if not exists businesses_payment_submitted_at_idx
  on businesses (payment_submitted_at)
  where payment_submitted_at is not null;
